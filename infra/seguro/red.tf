# Capa 4 (red interna) y capa 5 (perímetro): segmentación en tres niveles.
#   subredes públicas   balanceador y NAT
#   subredes de app     contenedores, con salida por NAT
#   subredes de datos   base de datos, sin ruta hacia Internet

resource "aws_vpc" "principal" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${local.nombre}-vpc" }
}

# El grupo de seguridad por omisión queda sin reglas.
resource "aws_default_security_group" "bloqueado" {
  vpc_id = aws_vpc.principal.id
}

resource "aws_flow_log" "vpc" {
  vpc_id          = aws_vpc.principal.id
  traffic_type    = "ALL"
  iam_role_arn    = aws_iam_role.flujo_vpc.arn
  log_destination = aws_cloudwatch_log_group.flujo_vpc.arn
}

resource "aws_subnet" "publica" {
  count                   = 2
  vpc_id                  = aws_vpc.principal.id
  cidr_block              = cidrsubnet(aws_vpc.principal.cidr_block, 8, count.index + 1)
  availability_zone       = local.zonas[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.nombre}-publica-${count.index + 1}" }
}

resource "aws_subnet" "app" {
  count                   = 2
  vpc_id                  = aws_vpc.principal.id
  cidr_block              = cidrsubnet(aws_vpc.principal.cidr_block, 8, count.index + 11)
  availability_zone       = local.zonas[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.nombre}-app-${count.index + 1}" }
}

resource "aws_subnet" "datos" {
  count                   = 2
  vpc_id                  = aws_vpc.principal.id
  cidr_block              = cidrsubnet(aws_vpc.principal.cidr_block, 8, count.index + 21)
  availability_zone       = local.zonas[count.index]
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.nombre}-datos-${count.index + 1}" }
}

resource "aws_internet_gateway" "principal" {
  vpc_id = aws_vpc.principal.id
}

resource "aws_eip" "nat" {
  domain = "vpc"
}

resource "aws_nat_gateway" "principal" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.publica[0].id
  depends_on    = [aws_internet_gateway.principal]
}

resource "aws_route_table" "publica" {
  vpc_id = aws_vpc.principal.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.principal.id
  }
}

resource "aws_route_table" "app" {
  vpc_id = aws_vpc.principal.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.principal.id
  }
}

# Sin ruta por omisión: la subred de datos no alcanza Internet.
resource "aws_route_table" "datos" {
  vpc_id = aws_vpc.principal.id
}

resource "aws_route_table_association" "publica" {
  count          = 2
  subnet_id      = aws_subnet.publica[count.index].id
  route_table_id = aws_route_table.publica.id
}

resource "aws_route_table_association" "app" {
  count          = 2
  subnet_id      = aws_subnet.app[count.index].id
  route_table_id = aws_route_table.app.id
}

resource "aws_route_table_association" "datos" {
  count          = 2
  subnet_id      = aws_subnet.datos[count.index].id
  route_table_id = aws_route_table.datos.id
}

# ---------- Grupos de seguridad (riesgo R12)

data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

resource "aws_security_group" "balanceador" {
  name        = "${local.nombre}-balanceador"
  description = "Balanceador: solo acepta trafico de CloudFront y del VPC Link"
  vpc_id      = aws_vpc.principal.id
}

resource "aws_security_group" "vpc_link" {
  name        = "${local.nombre}-vpc-link"
  description = "VPC Link de API Gateway hacia el balanceador"
  vpc_id      = aws_vpc.principal.id
}

resource "aws_security_group" "app" {
  name        = "${local.nombre}-app"
  description = "Contenedores de WordPress"
  vpc_id      = aws_vpc.principal.id
}

resource "aws_security_group" "datos" {
  name        = "${local.nombre}-datos"
  description = "MariaDB: solo acepta conexiones de los contenedores"
  vpc_id      = aws_vpc.principal.id
}

resource "aws_vpc_security_group_ingress_rule" "balanceador_desde_cloudfront" {
  security_group_id = aws_security_group.balanceador.id
  description       = "HTTPS desde CloudFront"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront.id
}

resource "aws_vpc_security_group_ingress_rule" "balanceador_desde_vpc_link" {
  security_group_id            = aws_security_group.balanceador.id
  description                  = "HTTPS desde el VPC Link de API Gateway"
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  referenced_security_group_id = aws_security_group.vpc_link.id
}

resource "aws_vpc_security_group_egress_rule" "balanceador_hacia_app" {
  security_group_id            = aws_security_group.balanceador.id
  description                  = "HTTP hacia los contenedores"
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
  referenced_security_group_id = aws_security_group.app.id
}

resource "aws_vpc_security_group_egress_rule" "vpc_link_hacia_balanceador" {
  security_group_id            = aws_security_group.vpc_link.id
  description                  = "HTTPS hacia el balanceador"
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  referenced_security_group_id = aws_security_group.balanceador.id
}

resource "aws_vpc_security_group_ingress_rule" "app_desde_balanceador" {
  #checkov:skip=CKV_AWS_260:El origen es el grupo de seguridad del balanceador, no 0.0.0.0/0
  security_group_id            = aws_security_group.app.id
  description                  = "HTTP desde el balanceador"
  ip_protocol                  = "tcp"
  from_port                    = 80
  to_port                      = 80
  referenced_security_group_id = aws_security_group.balanceador.id
}

resource "aws_vpc_security_group_egress_rule" "app_hacia_datos" {
  security_group_id            = aws_security_group.app.id
  description                  = "MariaDB"
  ip_protocol                  = "tcp"
  from_port                    = 3306
  to_port                      = 3306
  referenced_security_group_id = aws_security_group.datos.id
}

resource "aws_vpc_security_group_egress_rule" "app_hacia_https" {
  security_group_id = aws_security_group.app.id
  description       = "HTTPS saliente: API de AWS, pasarela y actualizaciones"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "datos_desde_app" {
  security_group_id            = aws_security_group.datos.id
  description                  = "MariaDB desde los contenedores"
  ip_protocol                  = "tcp"
  from_port                    = 3306
  to_port                      = 3306
  referenced_security_group_id = aws_security_group.app.id
}
