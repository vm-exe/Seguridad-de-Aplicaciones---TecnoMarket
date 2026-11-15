# Capa 1 (datos): almacenamiento de medios, respaldos y registros (riesgo R13).
# Los tres buckets bloquean el acceso público, cifran en reposo, exigen TLS,
# conservan versiones y registran sus accesos.

resource "aws_s3_bucket" "registros" {
  #checkov:skip=CKV_AWS_144:Bucket de registros de acceso; no requiere replica entre regiones
  #checkov:skip=CKV_AWS_145:Los registros de acceso del balanceador solo admiten cifrado SSE-S3
  #checkov:skip=CKV2_AWS_62:No se requieren notificaciones de eventos para registros de acceso
  #checkov:skip=CKV_AWS_18:Es el bucket de destino de los registros de acceso
  bucket = "${local.nombre}-registros-${local.cuenta}"
}

resource "aws_s3_bucket" "medios" {
  #checkov:skip=CKV_AWS_144:Los medios se regeneran desde el catalogo; no requieren replica entre regiones
  #checkov:skip=CKV2_AWS_62:No se requieren notificaciones de eventos
  bucket = "${local.nombre}-medios-${local.cuenta}"
}

resource "aws_s3_bucket" "respaldos" {
  #checkov:skip=CKV_AWS_144:La copia a una segunda region esta pendiente de implementar (riesgo R14)
  #checkov:skip=CKV2_AWS_62:No se requieren notificaciones de eventos
  bucket = "${local.nombre}-respaldos-${local.cuenta}"
}

locals {
  buckets = {
    registros = aws_s3_bucket.registros.id
    medios    = aws_s3_bucket.medios.id
    respaldos = aws_s3_bucket.respaldos.id
  }
  buckets_arn = {
    registros = aws_s3_bucket.registros.arn
    medios    = aws_s3_bucket.medios.arn
    respaldos = aws_s3_bucket.respaldos.arn
  }
}

resource "aws_s3_bucket_public_access_block" "todos" {
  for_each                = local.buckets
  bucket                  = each.value
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "todos" {
  for_each = local.buckets
  bucket   = each.value
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "registros" {
  bucket = aws_s3_bucket.registros.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "medios" {
  bucket = aws_s3_bucket.medios.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.medios.arn
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "respaldos" {
  bucket = aws_s3_bucket.respaldos.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.respaldos.arn
    }
  }
}

resource "aws_s3_bucket_logging" "medios" {
  bucket        = aws_s3_bucket.medios.id
  target_bucket = aws_s3_bucket.registros.id
  target_prefix = "s3/medios/"
}

resource "aws_s3_bucket_logging" "respaldos" {
  bucket        = aws_s3_bucket.respaldos.id
  target_bucket = aws_s3_bucket.registros.id
  target_prefix = "s3/respaldos/"
}

resource "aws_s3_bucket_lifecycle_configuration" "todos" {
  for_each = local.buckets
  bucket   = each.value

  rule {
    id     = "limpieza"
    status = "Enabled"
    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# CloudFront entrega sus registros mediante ACL, por lo que este bucket conserva
# las ACL habilitadas; el acceso público sigue bloqueado.
resource "aws_s3_bucket_ownership_controls" "registros" {
  #checkov:skip=CKV2_AWS_65:Los registros estandar de CloudFront requieren ACL en el bucket de destino
  bucket = aws_s3_bucket.registros.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

data "aws_iam_policy_document" "solo_tls" {
  for_each = local.buckets_arn

  statement {
    sid       = "RechazarSinTLS"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [each.value, "${each.value}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  # Solo en el bucket de registros: el balanceador escribe sus registros de acceso.
  dynamic "statement" {
    for_each = each.key == "registros" ? [1] : []
    content {
      sid       = "RegistrosDelBalanceador"
      effect    = "Allow"
      actions   = ["s3:PutObject"]
      resources = ["${each.value}/alb/*"]
      principals {
        type        = "AWS"
        identifiers = [data.aws_elb_service_account.principal.arn]
      }
    }
  }
}

resource "aws_s3_bucket_policy" "todos" {
  for_each   = local.buckets
  bucket     = each.value
  policy     = data.aws_iam_policy_document.solo_tls[each.key].json
  depends_on = [aws_s3_bucket_public_access_block.todos]
}
