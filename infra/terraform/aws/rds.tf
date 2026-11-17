# Base de datos administrada: RDS MySQL 8.4, privada, cifrada con KMS (AES-256),
# TLS obligatorio, backups, Multi-AZ, autenticación IAM y logs a CloudWatch.

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "mysql84" {
  name   = "${local.name}-mysql84"
  family = "mysql8.4"

  # Exigir TLS en tránsito a la base de datos
  parameter {
    name  = "require_secure_transport"
    value = "1"
  }
  parameter {
    name  = "tls_version"
    value = "TLSv1.2,TLSv1.3"
  }
  parameter {
    name  = "local_infile"
    value = "0"
  }
  parameter {
    name  = "general_log"
    value = "0"
  }
  parameter {
    name  = "slow_query_log"
    value = "1"
  }
}

resource "aws_iam_role" "rds_monitoring" {
  name = "${local.name}-rds-monitoring"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "monitoring.rds.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

resource "aws_db_instance" "main" {
  identifier     = "${local.name}-mysql"
  engine         = "mysql"
  engine_version = "8.4"
  instance_class = var.db_instance_class

  db_name  = "ventas_segura"
  username = "admin_master"
  # La contraseña maestra la genera y rota RDS en Secrets Manager (cifrada con la CMK):
  # nunca aparece en el código ni en el estado de Terraform.
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.main.arn

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.main.arn

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = var.db_multi_az
  parameter_group_name   = aws_db_parameter_group.mysql84.name

  iam_database_authentication_enabled = true
  auto_minor_version_upgrade          = true
  deletion_protection                 = true
  copy_tags_to_snapshot               = true
  skip_final_snapshot                 = false
  final_snapshot_identifier           = "${local.name}-mysql-final"
  backup_retention_period             = var.db_backup_retention_days
  backup_window                       = "06:00-07:00"
  maintenance_window                  = "sun:07:30-sun:08:30"

  enabled_cloudwatch_logs_exports = ["audit", "error", "slowquery"]

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.main.arn
  performance_insights_retention_period = 7

  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_monitoring.arn
}
