variable "project" {
  description = "Nombre corto del proyecto"
  type        = string
  default     = "ventas-segura"
}

variable "environment" {
  description = "Ambiente (dev, staging, prod)"
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment debe ser dev, staging o prod."
  }
}

variable "owner" {
  description = "Propietario del activo (ISO 27001 A.5.9)"
  type        = string
  default     = "equipo-seguridad"
}

variable "region" {
  description = "Región AWS"
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}(-gov)?-[a-z]+-[0-9]$", var.region))
    error_message = "region debe ser un codigo de region AWS valido (ej. us-east-1)."
  }
}

variable "vpc_cidr" {
  description = "CIDR de la VPC"
  type        = string
  default     = "10.20.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && tonumber(split("/", var.vpc_cidr)[1]) <= 20
    error_message = "vpc_cidr debe ser un CIDR IPv4 valido de /20 o mayor (se dividen 4 subredes)."
  }
}

variable "domain_name" {
  description = "Dominio público de la tienda (ej. tienda.ejemplo.com)"
  type        = string
}

variable "acm_certificate_arn" {
  description = "ARN del certificado ACM para el ALB (TLS 1.2/1.3)"
  type        = string
}

variable "container_image" {
  description = "Imagen OCI de la app (idealmente por digest: repo@sha256:...)"
  type        = string
}

variable "app_cpu" {
  description = "CPU de la tarea Fargate"
  type        = number
  default     = 512
}

variable "app_memory" {
  description = "Memoria (MiB) de la tarea Fargate"
  type        = number
  default     = 1024
}

variable "app_desired_count" {
  description = "Número de tareas"
  type        = number
  default     = 2

  validation {
    condition     = var.app_desired_count >= 1 && var.app_desired_count <= 10
    error_message = "app_desired_count debe estar entre 1 y 10."
  }
}

variable "db_instance_class" {
  description = "Clase de instancia RDS"
  type        = string
  default     = "db.t4g.small"
}

variable "db_multi_az" {
  description = "Alta disponibilidad Multi-AZ para RDS"
  type        = bool
  default     = true
}

variable "db_backup_retention_days" {
  description = "Días de retención de backups"
  type        = number
  default     = 14

  validation {
    condition     = var.db_backup_retention_days >= 7 && var.db_backup_retention_days <= 35
    error_message = "La retencion de respaldos debe estar entre 7 y 35 dias."
  }
}

variable "log_retention_days" {
  description = "Retención de logs en CloudWatch (mínimo 365 para auditoría)"
  type        = number
  default     = 365
}

variable "login_rate_limit" {
  description = "Máximo de peticiones al login por IP cada 5 minutos (WAF)"
  type        = number
  default     = 100
}

variable "alarm_email" {
  description = "Correo que recibe alarmas de seguridad (SNS)"
  type        = string
}

variable "admin_allowed_cidrs" {
  description = "CIDRs autorizados a /admin (vacío = sin restricción por IP)"
  type        = list(string)
  default     = []
}
