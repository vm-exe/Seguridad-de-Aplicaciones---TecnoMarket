# Roles de mínimo privilegio (tabla 3 del informe). Ninguna política usa
# comodines sobre acciones que admiten restricción por recurso.

data "aws_iam_policy_document" "confianza_ecs" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# ---------- tmgt-ecs-ejecucion: extraer la imagen, escribir registros y leer el secreto
resource "aws_iam_role" "ecs_ejecucion" {
  name               = "${local.nombre}-ecs-ejecucion"
  assume_role_policy = data.aws_iam_policy_document.confianza_ecs.json
}

data "aws_iam_policy_document" "ecs_ejecucion" {
  statement {
    sid       = "TokenDelRegistro"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid       = "ExtraerImagen"
    actions   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
    resources = [aws_ecr_repository.wordpress.arn]
  }
  statement {
    sid       = "EscribirRegistros"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.wordpress.arn}:*"]
  }
  statement {
    sid       = "LeerSecretoDeAplicacion"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.db_app.arn]
  }
  statement {
    sid       = "DescifrarSecreto"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.datos.arn]
  }
}

resource "aws_iam_role_policy" "ecs_ejecucion" {
  name   = "permisos"
  role   = aws_iam_role.ecs_ejecucion.id
  policy = data.aws_iam_policy_document.ecs_ejecucion.json
}

# ---------- tmgt-ecs-tarea: lo que el contenedor de WordPress puede hacer en ejecución
resource "aws_iam_role" "ecs_tarea" {
  name               = "${local.nombre}-ecs-tarea"
  assume_role_policy = data.aws_iam_policy_document.confianza_ecs.json
}

data "aws_iam_policy_document" "ecs_tarea" {
  statement {
    sid       = "ListarMedios"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.medios.arn]
  }
  statement {
    sid       = "LeerYEscribirMedios"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.medios.arn}/*"]
  }
  statement {
    sid       = "CifradoDeMedios"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.medios.arn]
  }
}

resource "aws_iam_role_policy" "ecs_tarea" {
  name   = "permisos"
  role   = aws_iam_role.ecs_tarea.id
  policy = data.aws_iam_policy_document.ecs_tarea.json
}

# ---------- tmgt-pipeline: federación OIDC con GitHub Actions, sin llaves de larga duración
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "confianza_pipeline" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Solo la rama principal del repositorio autorizado puede desplegar.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.repositorio_github}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "pipeline" {
  name               = "${local.nombre}-pipeline"
  assume_role_policy = data.aws_iam_policy_document.confianza_pipeline.json
}

data "aws_iam_policy_document" "pipeline" {
  statement {
    sid       = "TokenDelRegistro"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "PublicarImagen"
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload", "ecr:PutImage"
    ]
    resources = [aws_ecr_repository.wordpress.arn]
  }
  statement {
    sid       = "ActualizarServicio"
    actions   = ["ecs:UpdateService", "ecs:DescribeServices"]
    resources = [aws_ecs_service.wordpress.id]
  }
  statement {
    sid       = "EntregarRolesDeLaTarea"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.ecs_ejecucion.arn, aws_iam_role.ecs_tarea.arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "pipeline" {
  name   = "permisos"
  role   = aws_iam_role.pipeline.id
  policy = data.aws_iam_policy_document.pipeline.json
}

# ---------- tmgt-respaldo
data "aws_iam_policy_document" "confianza_respaldo" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "respaldo" {
  name               = "${local.nombre}-respaldo"
  assume_role_policy = data.aws_iam_policy_document.confianza_respaldo.json
}

data "aws_iam_policy_document" "respaldo" {
  statement {
    sid     = "CrearInstantaneas"
    actions = ["rds:CreateDBSnapshot", "rds:DescribeDBSnapshots"]
    resources = [
      aws_db_instance.tienda.arn,
      "arn:aws:rds:us-east-1:${local.cuenta}:snapshot:${local.nombre}-*"
    ]
  }
  statement {
    sid       = "EscribirRespaldos"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.respaldos.arn}/*"]
  }
  statement {
    sid       = "CifrarRespaldos"
    actions   = ["kms:GenerateDataKey"]
    resources = [aws_kms_key.respaldos.arn]
  }
}

resource "aws_iam_role_policy" "respaldo" {
  name   = "permisos"
  role   = aws_iam_role.respaldo.id
  policy = data.aws_iam_policy_document.respaldo.json
}

# ---------- tmgt-auditor: solo lectura, y solo con segundo factor
data "aws_iam_policy_document" "confianza_auditor" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${local.cuenta}:root"]
    }
    condition {
      test     = "Bool"
      variable = "aws:MultiFactorAuthPresent"
      values   = ["true"]
    }
  }
}

resource "aws_iam_role" "auditor" {
  name               = "${local.nombre}-auditor"
  assume_role_policy = data.aws_iam_policy_document.confianza_auditor.json
}

data "aws_iam_policy_document" "auditor" {
  statement {
    sid       = "ConsultarCloudTrail"
    actions   = ["cloudtrail:LookupEvents"]
    resources = ["*"]
  }
  statement {
    sid     = "LeerRegistros"
    actions = ["logs:GetLogEvents", "logs:FilterLogEvents", "logs:DescribeLogStreams"]
    resources = [
      "${aws_cloudwatch_log_group.wordpress.arn}:*",
      "${aws_cloudwatch_log_group.waf.arn}:*",
      "${aws_cloudwatch_log_group.api.arn}:*",
      "${aws_cloudwatch_log_group.flujo_vpc.arn}:*"
    ]
  }
}

resource "aws_iam_role_policy" "auditor" {
  name   = "permisos"
  role   = aws_iam_role.auditor.id
  policy = data.aws_iam_policy_document.auditor.json
}

# ---------- Roles de servicio
data "aws_iam_policy_document" "confianza_monitoreo_rds" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monitoreo_rds" {
  name               = "${local.nombre}-monitoreo-rds"
  assume_role_policy = data.aws_iam_policy_document.confianza_monitoreo_rds.json
}

resource "aws_iam_role_policy_attachment" "monitoreo_rds" {
  role       = aws_iam_role.monitoreo_rds.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

data "aws_iam_policy_document" "confianza_flujo_vpc" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "flujo_vpc" {
  name               = "${local.nombre}-flujo-vpc"
  assume_role_policy = data.aws_iam_policy_document.confianza_flujo_vpc.json
}

data "aws_iam_policy_document" "flujo_vpc" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = ["${aws_cloudwatch_log_group.flujo_vpc.arn}:*"]
  }
}

resource "aws_iam_role_policy" "flujo_vpc" {
  name   = "permisos"
  role   = aws_iam_role.flujo_vpc.id
  policy = data.aws_iam_policy_document.flujo_vpc.json
}

# ---------- Identidad de los administradores de la tienda (Amazon Cognito, OIDC con MFA)
resource "aws_cognito_user_pool" "administradores" {
  name              = "${local.nombre}-administradores"
  mfa_configuration = "ON"

  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length                   = 15
    require_lowercase                = false
    require_uppercase                = false
    require_numbers                  = false
    require_symbols                  = false
    temporary_password_validity_days = 1
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
  }
}

resource "aws_cognito_user_pool_client" "wordpress" {
  name                                 = "${local.nombre}-wordpress"
  user_pool_id                         = aws_cognito_user_pool.administradores.id
  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  # La ruta de retorno depende del plugin OIDC que se instale en WordPress.
  callback_urls = ["https://${var.dominio}/wp-admin/admin-ajax.php?action=openid-connect-authorize"]
}
