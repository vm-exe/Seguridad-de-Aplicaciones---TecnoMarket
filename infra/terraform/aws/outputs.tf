output "alb_dns_name" {
  description = "DNS del ALB (crear CNAME/ALIAS del dominio hacia este valor)"
  value       = aws_lb.main.dns_name
}

output "waf_web_acl_arn" {
  description = "ARN del Web ACL"
  value       = aws_wafv2_web_acl.main.arn
}

output "rds_endpoint" {
  description = "Endpoint privado de RDS"
  value       = aws_db_instance.main.address
}

output "uploads_bucket" {
  description = "Bucket privado de imagenes"
  value       = aws_s3_bucket.uploads.bucket
}

output "app_log_group" {
  description = "Log group de la aplicacion (fuente para SIEM)"
  value       = aws_cloudwatch_log_group.app.name
}

output "kms_key_arn" {
  description = "CMK de cifrado en reposo"
  value       = aws_kms_key.main.arn
}

output "db_master_secret_arn" {
  description = "ARN del secreto de Secrets Manager con la contrasena maestra de RDS (gestionado por RDS)"
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
}
