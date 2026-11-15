variable "dominio" {
  description = "Nombre de dominio público de la tienda"
  type        = string
  default     = "tienda.tecnomarket.example"
}

variable "certificado_acm_arn" {
  description = "ARN del certificado de ACM (us-east-1) para CloudFront y el balanceador"
  type        = string
}

variable "imagen_wordpress" {
  description = "Imagen de WordPress con WooCommerce y el complemento, referenciada por digest"
  type        = string

  validation {
    condition     = can(regex("@sha256:[a-f0-9]{64}$", var.imagen_wordpress))
    error_message = "La imagen debe referenciarse por digest (imagen@sha256:...), no por etiqueta."
  }
}

variable "repositorio_github" {
  description = "Repositorio autorizado a desplegar, con el formato organizacion/repositorio"
  type        = string
}

variable "retencion_registros_dias" {
  description = "Retención de los registros, según la política del informe"
  type        = number
  default     = 180
}
