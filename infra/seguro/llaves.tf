# Capa 1 (datos): llaves administradas por el cliente, separadas por tipo de dato
# y con rotación anual automática.

data "aws_iam_policy_document" "llave_base" {
  #checkov:skip=CKV_AWS_109:Politica de llave KMS; el recurso es la propia llave a la que se adjunta
  #checkov:skip=CKV_AWS_111:Politica de llave KMS; el recurso es la propia llave a la que se adjunta
  #checkov:skip=CKV_AWS_356:Politica de llave KMS; el recurso es la propia llave a la que se adjunta
  statement {
    sid       = "AdministracionPorLaCuenta"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${local.cuenta}:root"]
    }
  }
}

data "aws_iam_policy_document" "llave_registros" {
  #checkov:skip=CKV_AWS_109:Politica de llave KMS; el recurso es la propia llave a la que se adjunta
  #checkov:skip=CKV_AWS_111:Politica de llave KMS; el recurso es la propia llave a la que se adjunta
  #checkov:skip=CKV_AWS_356:Politica de llave KMS; el recurso es la propia llave a la que se adjunta
  source_policy_documents = [data.aws_iam_policy_document.llave_base.json]

  statement {
    sid       = "UsoPorCloudWatchLogs"
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["logs.us-east-1.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "datos" {
  description             = "TecnoMarket GT: base de datos y secretos"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.llave_base.json
}

resource "aws_kms_key" "medios" {
  description             = "TecnoMarket GT: medios de la tienda"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.llave_base.json
}

resource "aws_kms_key" "respaldos" {
  description             = "TecnoMarket GT: respaldos"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.llave_base.json
}

resource "aws_kms_key" "registros" {
  description             = "TecnoMarket GT: registros"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.llave_registros.json
}
