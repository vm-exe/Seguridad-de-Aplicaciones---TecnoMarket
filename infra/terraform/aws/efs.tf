# Volumen persistente y cifrado para UPLOAD_DIR=/data/uploads (imágenes de productos).
# El contenedor corre con rootfs de sólo lectura; sólo este punto de montaje es escribible.

resource "aws_efs_file_system" "uploads" {
  creation_token = "${local.name}-uploads"
  encrypted      = true
  kms_key_id     = aws_kms_key.main.arn

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }

  tags = { Name = "${local.name}-uploads" }
}

resource "aws_efs_backup_policy" "uploads" {
  file_system_id = aws_efs_file_system.uploads.id
  backup_policy {
    status = "ENABLED"
  }
}

resource "aws_security_group" "efs" {
  name        = "${local.name}-efs"
  description = "EFS de imagenes - solo desde la app"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "efs_from_app" {
  security_group_id            = aws_security_group.efs.id
  description                  = "NFS desde la app"
  referenced_security_group_id = aws_security_group.app.id
  from_port                    = 2049
  to_port                      = 2049
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "app_to_efs" {
  security_group_id            = aws_security_group.app.id
  description                  = "App hacia EFS"
  referenced_security_group_id = aws_security_group.efs.id
  from_port                    = 2049
  to_port                      = 2049
  ip_protocol                  = "tcp"
}

resource "aws_efs_mount_target" "uploads" {
  count           = 2
  file_system_id  = aws_efs_file_system.uploads.id
  subnet_id       = aws_subnet.private[count.index].id
  security_groups = [aws_security_group.efs.id]
}

# Access point: fuerza UID/GID del usuario no-root del contenedor (1001)
resource "aws_efs_access_point" "uploads" {
  file_system_id = aws_efs_file_system.uploads.id

  posix_user {
    uid = 1001
    gid = 1001
  }

  root_directory {
    path = "/uploads"
    creation_info {
      owner_uid   = 1001
      owner_gid   = 1001
      permissions = "0750"
    }
  }
}
