# Secretos de la aplicación en AWS Secrets Manager, cifrados con la CMK.
# Los valores generados aquí (BETTER_AUTH_SECRET, claves AES/HMAC) quedan en el estado de Terraform:
# por eso el backend S3 es obligatorio, cifrado con KMS y con acceso restringido (providers.tf).
# La contraseña maestra de RDS ya NO se genera aquí: la gestiona RDS (manage_master_user_password).
# Los secretos de terceros (SMTP, PayPal) se cargan manualmente fuera de Terraform.

resource "random_password" "auth_secret" {
  length  = 48
  special = false
}

resource "random_bytes" "field_key" {
  length = 32
}

resource "random_bytes" "hmac_key" {
  length = 32
}

locals {
  app_secret_names = [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "FIELD_ENCRYPTION_KEY",
    "HMAC_KEY",
    "SMTP_USER",
    "SMTP_PASS",
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
  ]
}

resource "aws_secretsmanager_secret" "app" {
  #checkov:skip=CKV2_AWS_57:La rotacion automatica requiere Lambda; se aplica rotacion manual trimestral documentada en la politica
  for_each                = toset(local.app_secret_names)
  name                    = "${local.name}/app/${each.value}"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "auth_secret" {
  secret_id     = aws_secretsmanager_secret.app["BETTER_AUTH_SECRET"].id
  secret_string = random_password.auth_secret.result
}

resource "aws_secretsmanager_secret_version" "field_key" {
  secret_id     = aws_secretsmanager_secret.app["FIELD_ENCRYPTION_KEY"].id
  secret_string = random_bytes.field_key.base64
}

resource "aws_secretsmanager_secret_version" "hmac_key" {
  secret_id     = aws_secretsmanager_secret.app["HMAC_KEY"].id
  secret_string = random_bytes.hmac_key.base64
}

# DATABASE_URL del usuario de aplicación (ventas_app, sólo DML).
# Plantilla SIN contraseña: actualizar el secreto con la URL completa tras crear el usuario.
# El usuario se crea tras el primer despliegue con el script de infra/db/init
# conectándose con las credenciales maestras (ver README).
resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.app["DATABASE_URL"].id
  secret_string = "mysql://ventas_app@${aws_db_instance.main.address}:3306/ventas_segura?ssl={\"rejectUnauthorized\":true}"

  lifecycle {
    ignore_changes = [secret_string]
  }
}
