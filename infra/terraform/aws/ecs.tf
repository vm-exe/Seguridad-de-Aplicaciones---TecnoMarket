# ECS Fargate: contenedores sin servidor en subredes privadas, sin IP pública,
# rootfs de sólo lectura, usuario no-root, secretos inyectados desde Secrets Manager.

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name}/app"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.main.arn
}

resource "aws_ecs_cluster" "main" {
  name = "${local.name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  configuration {
    execute_command_configuration {
      kms_key_id = aws_kms_key.main.arn
      logging    = "OVERRIDE"
      log_configuration {
        cloud_watch_encryption_enabled = true
        cloud_watch_log_group_name     = aws_cloudwatch_log_group.app.name
      }
    }
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.app_cpu
  memory                   = var.app_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "uploads"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.uploads.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.uploads.id
        iam             = "ENABLED"
      }
    }
  }

  volume {
    name = "tmp"
  }

  volume {
    name = "next-cache"
  }

  container_definitions = jsonencode([
    {
      name                   = "app"
      image                  = var.container_image
      essential              = true
      readonlyRootFilesystem = true
      user                   = "1001:1001"
      privileged             = false
      linuxParameters = {
        capabilities = { drop = ["ALL"] }
        initProcessEnabled = true
      }
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      mountPoints = [
        { sourceVolume = "uploads", containerPath = "/data/uploads", readOnly = false },
        { sourceVolume = "tmp", containerPath = "/tmp", readOnly = false },
        { sourceVolume = "next-cache", containerPath = "/app/.next/cache", readOnly = false }
      ]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "3000" },
        { name = "HOSTNAME", value = "0.0.0.0" },
        { name = "APP_URL", value = "https://${var.domain_name}" },
        { name = "BETTER_AUTH_URL", value = "https://${var.domain_name}" },
        { name = "UPLOAD_DIR", value = "/data/uploads" },
        { name = "TRUST_PROXY", value = "true" },
        { name = "LOG_LEVEL", value = "info" },
        { name = "PAYMENT_MODE", value = "paypal" },
        { name = "PAYPAL_API_BASE", value = "https://api-m.paypal.com" },
        { name = "SMTP_HOST", value = "email-smtp.${var.region}.amazonaws.com" },
        { name = "SMTP_PORT", value = "587" },
        { name = "SMTP_FROM", value = "no-reply@${var.domain_name}" }
      ]
      secrets = [
        for name in local.app_secret_names : {
          name      = name
          valueFrom = aws_secretsmanager_secret.app[name].arn
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "app"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])
}

resource "aws_ecs_service" "app" {
  name            = "${local.name}-app"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.app_desired_count
  launch_type     = "FARGATE"

  platform_version = "LATEST"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [aws_lb_listener.https, aws_efs_mount_target.uploads]
}
