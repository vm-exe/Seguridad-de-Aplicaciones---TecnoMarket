# Capa 7 (R10): registros cifrados, con retención definida, fuera del alcance
# de escritura de la aplicación.

resource "aws_cloudwatch_log_group" "wordpress" {
  #checkov:skip=CKV_AWS_338:La politica de retencion del informe fija 180 dias
  name              = "/${local.nombre}/wordpress"
  retention_in_days = var.retencion_registros_dias
  kms_key_id        = aws_kms_key.registros.arn
}

resource "aws_cloudwatch_log_group" "flujo_vpc" {
  #checkov:skip=CKV_AWS_338:La politica de retencion del informe fija 180 dias
  name              = "/${local.nombre}/flujo-vpc"
  retention_in_days = var.retencion_registros_dias
  kms_key_id        = aws_kms_key.registros.arn
}

resource "aws_cloudwatch_log_group" "api" {
  #checkov:skip=CKV_AWS_338:La politica de retencion del informe fija 180 dias
  name              = "/${local.nombre}/api-gateway"
  retention_in_days = var.retencion_registros_dias
  kms_key_id        = aws_kms_key.registros.arn
}

# El nombre debe comenzar con aws-waf-logs- para que AWS WAF pueda escribir en él.
resource "aws_cloudwatch_log_group" "waf" {
  #checkov:skip=CKV_AWS_338:La politica de retencion del informe fija 180 dias
  name              = "aws-waf-logs-${local.nombre}"
  retention_in_days = var.retencion_registros_dias
  kms_key_id        = aws_kms_key.registros.arn
}
