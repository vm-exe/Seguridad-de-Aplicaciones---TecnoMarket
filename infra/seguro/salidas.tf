output "dominio_cloudfront" {
  description = "Nombre de CloudFront al que debe apuntar el registro DNS de la tienda"
  value       = aws_cloudfront_distribution.tienda.domain_name
}

output "rol_pipeline" {
  description = "Rol que asume GitHub Actions para desplegar"
  value       = aws_iam_role.pipeline.arn
}
