# Infraestructura como Código – AWS (Terraform)

Arquitectura cloud de referencia para **Ventas Online Segura** (Fase 2 y Fase 5 del proyecto).

```
Usuario ──HTTPS(TLS1.2/1.3)──► AWS WAFv2 ──► ALB (subred pública)
                                               │ :3000 (SG app ← SG alb)
                                               ▼
                                     ECS Fargate (subred privada, sin IP pública,
                                     rootfs read-only, no-root, secretos de Secrets Manager)
                                       │ :3306 TLS (SG db ← SG app)      │ NFS TLS
                                       ▼                                  ▼
                              RDS MySQL 8.4 (privado, KMS,         EFS cifrado (imágenes)
                              Multi-AZ, backups, IAM auth)
Logs: VPC Flow Logs, WAF, ALB, ECS, RDS ──► CloudWatch (KMS, 365 días) ──► alarmas SNS / SIEM
```

| Archivo | Controles |
|---|---|
| `network.tf` | VPC, subredes públicas/privadas, NAT, Flow Logs, SG por defecto cerrado |
| `security_groups.tf` | Microsegmentación ALB→app→db; **sin puerto 22** |
| `alb.tf` | TLS `ELBSecurityPolicy-TLS13-1-2-2021-06`, HTTP→HTTPS, `drop_invalid_header_fields`, logs |
| `waf.tf` | Reglas administradas (Common, SQLi, KnownBadInputs, IpReputation), rate-limit login, allowlist /admin |
| `ecs.tf` | Fargate, `readonlyRootFilesystem`, `drop ALL` capabilities, usuario 1001 |
| `rds.tf` | Cifrado KMS (AES-256), `require_secure_transport`, backups, deletion protection |
| `kms.tf` | CMK con rotación automática |
| `secrets.tf` | Secrets Manager cifrado con CMK |
| `s3.tf` / `efs.tf` | Bloqueo de acceso público, SSE-KMS, versionado, política TLS-only |
| `iam.tf` | Menor privilegio: execution role (secretos de la app) y task role (S3 prefijo + EFS AP) |
| `cloudwatch.tf` | Métricas de auditoría, alarmas de fuerza bruta, IDOR, manipulación de pago, WAF, 5xx |

## Uso

```bash
cd infra/terraform/aws
cp terraform.tfvars.example terraform.tfvars   # completar
cp backend.hcl.example backend.hcl             # bucket y clave KMS del estado (no versionar)
terraform init -backend-config=backend.hcl
git add .terraform.lock.hcl                    # fija los hashes de los providers (versionar)
terraform plan -out plan.tfplan
terraform apply plan.tfplan
```

Tras el primer `apply`:
1. Crear los usuarios `ventas_app` / `ventas_migrator` en RDS ejecutando las sentencias de `infra/db/init/01-usuarios.sh` (desde una tarea ECS one-off o bastión SSM, nunca exponiendo RDS).
2. Actualizar el secreto `.../app/DATABASE_URL` con la contraseña de `ventas_app`.
3. Cargar `SMTP_USER`, `SMTP_PASS`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` en Secrets Manager.
4. Ejecutar la migración (`npm run db:migrate`) como tarea ECS one-off con `MIGRATOR_DATABASE_URL`.

### Estado remoto y secretos

- El backend S3 es obligatorio (`providers.tf`, configuración parcial con `backend.hcl`): estado cifrado con KMS, versionado y con bloqueo (`use_lockfile`).
- Para validar sin AWS: `terraform init -backend=false && terraform validate`.
- La contraseña maestra de RDS **no** está en el código ni en el estado: `manage_master_user_password = true` hace que RDS la genere, la guarde en Secrets Manager (cifrada con la CMK) y la rote. Su ARN está en el output `db_master_secret_arn`.
- Los secretos de la app generados aquí (`BETTER_AUTH_SECRET`, claves AES/HMAC) sí pasan por el estado; por eso el backend cifrado no es opcional.

### Health checks

| Comprobación | Ruta | Motivo |
|---|---|---|
| Target group del ALB | `/api/health?db=1` (readiness) | Saca del balanceo una tarea que no puede llegar a RDS |
| ECS / Docker `HEALTHCHECK` | `/api/health` (liveness) | Reinicia solo si el proceso no responde; una caída de RDS no provoca reinicios en cascada |

### Validaciones

`variables.tf` valida `environment` (dev/staging/prod), `region`, `vpc_cidr` (CIDR válido, /20 o mayor), `app_desired_count` (1–10) y la retención de respaldos (7–35 días).

## Análisis estático (Checkov)

```bash
pip install checkov
checkov -d infra/terraform --compact
```

Resultado actual: **288 checks aprobados, 0 fallidos, 24 omitidos con justificación inline** (`#checkov:skip=...`). Las omisiones son riesgos aceptados documentados (p. ej. replicación entre regiones por costo, SSE-S3 obligatorio para logs del ALB, Resource `*` propio de políticas de clave KMS).

> Costos: NAT Gateway, ALB, RDS Multi-AZ y WAF generan costo. Para la demostración académica usar `db_multi_az = false`, `app_desired_count = 1` y destruir con `terraform destroy` (desactivar antes `deletion_protection`).
