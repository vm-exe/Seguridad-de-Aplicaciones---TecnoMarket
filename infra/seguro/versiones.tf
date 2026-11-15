# TecnoMarket GT - arquitectura de seguridad cloud objetivo (versión corregida).
#
# Estos archivos describen la arquitectura de la sección 1.4 del informe. Se
# auditan con Checkov y se validan con "terraform validate"; no se aplican en
# una cuenta real durante el proyecto.
#
# CloudFront y su WAF solo se administran desde us-east-1, por lo que todo el
# despliegue se fija en esa región.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      Proyecto = "TecnoMarket GT"
      Entorno  = "laboratorio-academico"
    }
  }
}

data "aws_caller_identity" "actual" {}
data "aws_elb_service_account" "principal" {}

locals {
  nombre = "tmgt"
  cuenta = data.aws_caller_identity.actual.account_id
  zonas  = ["us-east-1a", "us-east-1b"]
}
