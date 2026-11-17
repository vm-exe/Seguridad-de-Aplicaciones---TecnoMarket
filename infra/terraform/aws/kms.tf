# Clave maestra (CMK) para cifrado en reposo: RDS, S3, Secrets Manager, CloudWatch Logs.
# Rotación automática anual habilitada (gestión de claves - capa de Datos).

data "aws_iam_policy_document" "kms" {
  #checkov:skip=CKV_AWS_109:Politica de CLAVE KMS; en key policies Resource "*" se refiere a la propia clave
  #checkov:skip=CKV_AWS_111:Politica de CLAVE KMS; administracion delegada a IAM de la cuenta
  #checkov:skip=CKV_AWS_356:Politica de CLAVE KMS; Resource "*" es obligatorio en key policies
  statement {
    sid       = "AdministracionCuenta"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${local.account_id}:root"]
    }
  }

  statement {
    sid = "CloudWatchLogs"
    actions = [
      "kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*",
      "kms:GenerateDataKey*", "kms:Describe*"
    ]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.${var.region}.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:aws:logs:${var.region}:${local.account_id}:*"]
    }
  }

  # CloudWatch Alarms publica en el tópico SNS cifrado con esta CMK
  statement {
    sid       = "CloudWatchAlarmasSNS"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "main" {
  description             = "${local.name} - cifrado de datos en reposo"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.kms.json
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.main.key_id
}
