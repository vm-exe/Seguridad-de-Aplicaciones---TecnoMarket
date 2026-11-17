# Roles IAM con MENOR PRIVILEGIO para ECS.
#  - execution role: lo usa el agente ECS para descargar la imagen, escribir logs
#    y leer SOLO los secretos de esta aplicación.
#  - task role: lo usa el código de la app; sólo EFS (vía access point) y S3 en el prefijo de imágenes.

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

# ---------------- Execution role ----------------
resource "aws_iam_role" "ecs_execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "ecs_execution_secrets" {
  statement {
    sid       = "LeerSecretosApp"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for s in aws_secretsmanager_secret.app : s.arn]
  }
  statement {
    sid       = "DescifrarConCMK"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.main.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name   = "secrets-read"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution_secrets.json
}

# ---------------- Task role (aplicación) ----------------
resource "aws_iam_role" "ecs_task" {
  name               = "${local.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "ecs_task" {
  statement {
    sid       = "ImagenesProductosS3"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = ["${aws_s3_bucket.uploads.arn}/productos/*"]
  }
  statement {
    sid       = "CifradoObjetosS3"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [aws_kms_key.main.arn]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${var.region}.amazonaws.com"]
    }
  }
  statement {
    sid = "MontarEFS"
    actions = [
      "elasticfilesystem:ClientMount",
      "elasticfilesystem:ClientWrite"
    ]
    resources = [aws_efs_file_system.uploads.arn]
    condition {
      test     = "StringEquals"
      variable = "elasticfilesystem:AccessPointArn"
      values   = [aws_efs_access_point.uploads.arn]
    }
  }
}

resource "aws_iam_role_policy" "ecs_task" {
  name   = "app-least-privilege"
  role   = aws_iam_role.ecs_task.id
  policy = data.aws_iam_policy_document.ecs_task.json
}
