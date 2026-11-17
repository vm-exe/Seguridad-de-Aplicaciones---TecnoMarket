# Buckets: imágenes de productos (privado, servido por la app) y logs de acceso del ALB.

resource "random_id" "suffix" {
  byte_length = 4
}

# ---------------------- Bucket de imágenes (uploads) ----------------------
resource "aws_s3_bucket" "uploads" {
  #checkov:skip=CKV_AWS_144:Replicacion entre regiones fuera del alcance academico (costo); se documenta como riesgo aceptado
  #checkov:skip=CKV2_AWS_62:Notificaciones de eventos no requeridas
  bucket = "${local.name}-uploads-${random_id.suffix.hex}"
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.main.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_logging" "uploads" {
  bucket        = aws_s3_bucket.uploads.id
  target_bucket = aws_s3_bucket.logs.id
  target_prefix = "s3-access/uploads/"
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    id     = "versiones-antiguas"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "uploads_tls" {
  statement {
    sid       = "DenegarSinTLS"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.uploads.arn, "${aws_s3_bucket.uploads.arn}/*"]
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
}

resource "aws_s3_bucket_policy" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  policy = data.aws_iam_policy_document.uploads_tls.json
}

# ---------------------- Bucket de logs (ALB / S3 access) ----------------------
resource "aws_s3_bucket" "logs" {
  #checkov:skip=CKV_AWS_144:Replicacion entre regiones fuera del alcance (costo)
  #checkov:skip=CKV_AWS_145:Los access logs del ALB solo admiten SSE-S3 (AES256), no SSE-KMS
  #checkov:skip=CKV_AWS_18:Es el bucket destino de logs; no se registra a si mismo
  #checkov:skip=CKV2_AWS_62:Notificaciones de eventos no requeridas
  bucket = "${local.name}-logs-${random_id.suffix.hex}"
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "logs" {
  bucket = aws_s3_bucket.logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

# Trivy AVD-AWS-0132 aceptado: los access logs del ALB solo admiten SSE-S3 (AES256);
# AWS no permite SSE-KMS para ese destino. El bucket sigue cifrado, con acceso público
# bloqueado y política solo-TLS.
#trivy:ignore:AVD-AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    id     = "retencion-logs"
    status = "Enabled"
    filter {}
    transition {
      days          = 90
      storage_class = "GLACIER"
    }
    expiration {
      days = 400
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_elb_service_account" "main" {}

data "aws_iam_policy_document" "logs" {
  statement {
    sid       = "ALBAccessLogs"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.logs.arn}/alb/AWSLogs/${local.account_id}/*"]
    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.main.arn]
    }
  }

  statement {
    sid       = "S3ServerAccessLogs"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.logs.arn}/s3-access/*"]
    principals {
      type        = "Service"
      identifiers = ["logging.s3.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }

  statement {
    sid       = "DenegarSinTLS"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.logs.arn, "${aws_s3_bucket.logs.arn}/*"]
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
}

resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = data.aws_iam_policy_document.logs.json
}
