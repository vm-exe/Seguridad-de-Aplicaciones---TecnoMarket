terraform {
  required_version = ">= 1.6.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Estado remoto cifrado y con bloqueo (crear el bucket/tabla previamente).
  # Configuración parcial: los valores se pasan con
  #   terraform init -backend-config=backend.hcl
  # (copiar backend.hcl.example). Así no quedan nombres de cuenta en el repositorio.
  # Para validar sin AWS: terraform init -backend=false && terraform validate
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Proyecto      = var.project
      Ambiente      = var.environment
      Propietario   = var.owner
      Clasificacion = "Confidencial"
      GestionadoPor = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_availability_zones" "available" {
  #checkov:skip=CKV_AWS_394:Se usan explicitamente solo las 2 primeras AZ via slice()
  state = "available"
}

locals {
  name       = "${var.project}-${var.environment}"
  account_id = data.aws_caller_identity.current.account_id
  azs        = slice(data.aws_availability_zones.available.names, 0, 2)
}
