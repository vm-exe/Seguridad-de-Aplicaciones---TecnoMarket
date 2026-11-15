# Capa 1 (datos) y capa 4 (red): base de datos administrada (riesgos R08, R12, R13, R14).

resource "aws_db_subnet_group" "datos" {
  name       = "${local.nombre}-datos"
  subnet_ids = aws_subnet.datos[*].id
}

resource "aws_db_parameter_group" "mariadb" {
  name   = "${local.nombre}-mariadb"
  family = "mariadb11.4"

  # Rechaza conexiones sin TLS.
  parameter {
    name  = "require_secure_transport"
    value = "1"
  }
}

resource "aws_db_instance" "tienda" {
  identifier     = "${local.nombre}-mariadb"
  engine         = "mariadb"
  engine_version = "11.4"
  instance_class = "db.t4g.medium"

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true
  kms_key_id        = aws_kms_key.datos.arn

  db_name  = "tecnomarket"
  username = "tmgt_admin"
  # La contraseña maestra la genera y la rota RDS en Secrets Manager.
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.datos.arn

  db_subnet_group_name   = aws_db_subnet_group.datos.name
  vpc_security_group_ids = [aws_security_group.datos.id]
  parameter_group_name   = aws_db_parameter_group.mariadb.name
  publicly_accessible    = false
  multi_az               = true

  iam_database_authentication_enabled = true
  auto_minor_version_upgrade          = true
  deletion_protection                 = true
  copy_tags_to_snapshot               = true
  backup_retention_period             = 30
  skip_final_snapshot                 = false
  final_snapshot_identifier           = "${local.nombre}-mariadb-final"

  enabled_cloudwatch_logs_exports = ["audit", "error", "general", "slowquery"]
  monitoring_interval             = 60
  monitoring_role_arn             = aws_iam_role.monitoreo_rds.arn
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.datos.arn
}

# Contraseña de la cuenta de aplicación tmgt_app (privilegios mínimos sobre el
# esquema de la tienda). El valor se carga fuera de Terraform para que no quede
# en el código ni en el estado.
resource "aws_secretsmanager_secret" "db_app" {
  #checkov:skip=CKV2_AWS_57:La rotacion de la cuenta de aplicacion requiere una funcion Lambda, pendiente de implementar
  name       = "${local.nombre}/db/app"
  kms_key_id = aws_kms_key.datos.arn
}
