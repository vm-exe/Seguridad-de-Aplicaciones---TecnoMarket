CREATE TABLE `auditoria` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ts` datetime(3) NOT NULL,
	`actor_id` varchar(36),
	`actor_email` varchar(255),
	`accion` varchar(64) NOT NULL,
	`objetivo` varchar(128),
	`resultado` enum('ok','denegado','error') NOT NULL,
	`ip` varchar(45),
	`user_agent` varchar(255),
	`detalle` json,
	`prev_hash` char(64) NOT NULL,
	`hash` char(64) NOT NULL,
	CONSTRAINT `auditoria_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `categorias` (
	`id` int AUTO_INCREMENT NOT NULL,
	`nombre` varchar(50) NOT NULL,
	`activo` boolean NOT NULL DEFAULT true,
	CONSTRAINT `categorias_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cliente_perfil` (
	`user_id` varchar(36) NOT NULL,
	`nombres` varchar(80) NOT NULL,
	`apellidos` varchar(80) NOT NULL,
	`telefono` varchar(20) NOT NULL,
	`dpi_cifrado` varchar(255) NOT NULL,
	`dpi_hash` char(64) NOT NULL,
	`legacy_cliente_id` int,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `cliente_perfil_user_id` PRIMARY KEY(`user_id`),
	CONSTRAINT `cliente_perfil_dpi_hash_uq` UNIQUE(`dpi_hash`)
);
--> statement-breakpoint
CREATE TABLE `configuracion` (
	`clave` varchar(50) NOT NULL,
	`valor` varchar(255) NOT NULL,
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `configuracion_clave` PRIMARY KEY(`clave`)
);
--> statement-breakpoint
CREATE TABLE `orden_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orden_id` varchar(36) NOT NULL,
	`producto_id` int NOT NULL,
	`nombre` varchar(200) NOT NULL,
	`precio_unitario` decimal(10,2) NOT NULL,
	`cantidad` int NOT NULL,
	CONSTRAINT `orden_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ordenes` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`estado` enum('pendiente','pagada','cancelada','fallida') NOT NULL DEFAULT 'pendiente',
	`total` decimal(10,2) NOT NULL,
	`moneda` char(3) NOT NULL,
	`proveedor_pago` enum('paypal','simulado','legado') NOT NULL,
	`referencia_pago` varchar(64),
	`captura_id` varchar(64),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`pagada_at` datetime(3),
	CONSTRAINT `ordenes_id` PRIMARY KEY(`id`),
	CONSTRAINT `ordenes_referencia_pago_uq` UNIQUE(`referencia_pago`)
);
--> statement-breakpoint
CREATE TABLE `producto_imagenes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`producto_id` int NOT NULL,
	`archivo` varchar(64) NOT NULL,
	`mime` varchar(32) NOT NULL,
	`principal` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `producto_imagenes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `productos` (
	`id` int NOT NULL,
	`nombre` varchar(200) NOT NULL,
	`descripcion` text NOT NULL,
	`detalles` text NOT NULL,
	`precio` decimal(10,2) NOT NULL,
	`descuento` smallint NOT NULL DEFAULT 0,
	`stock` int NOT NULL DEFAULT 0,
	`categoria_id` int NOT NULL,
	`activo` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `productos_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` varchar(36) NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` datetime(3),
	`refresh_token_expires_at` datetime(3),
	`scope` text,
	`password` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `account_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` varchar(36) NOT NULL,
	`key` varchar(255) NOT NULL,
	`count` int NOT NULL,
	`last_request` bigint NOT NULL,
	CONSTRAINT `rate_limit_id` PRIMARY KEY(`id`),
	CONSTRAINT `rate_limit_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` varchar(36) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`token` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` varchar(36) NOT NULL,
	`impersonated_by` text,
	CONSTRAINT `session_id` PRIMARY KEY(`id`),
	CONSTRAINT `session_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `two_factor` (
	`id` varchar(36) NOT NULL,
	`secret` varchar(255) NOT NULL,
	`backup_codes` text NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`verified` boolean DEFAULT true,
	`failed_verification_count` int DEFAULT 0,
	`locked_until` datetime(3),
	CONSTRAINT `two_factor_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`email_verified` boolean NOT NULL DEFAULT false,
	`image` text,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`role` text,
	`banned` boolean DEFAULT false,
	`ban_reason` text,
	`ban_expires` datetime(3),
	`two_factor_enabled` boolean DEFAULT false,
	CONSTRAINT `user_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` varchar(36) NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `verification_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `cliente_perfil` ADD CONSTRAINT `cliente_perfil_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `orden_items` ADD CONSTRAINT `orden_items_orden_id_ordenes_id_fk` FOREIGN KEY (`orden_id`) REFERENCES `ordenes`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ordenes` ADD CONSTRAINT `ordenes_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `producto_imagenes` ADD CONSTRAINT `producto_imagenes_producto_id_productos_id_fk` FOREIGN KEY (`producto_id`) REFERENCES `productos`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `productos` ADD CONSTRAINT `productos_categoria_id_categorias_id_fk` FOREIGN KEY (`categoria_id`) REFERENCES `categorias`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `account` ADD CONSTRAINT `account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `session` ADD CONSTRAINT `session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `two_factor` ADD CONSTRAINT `two_factor_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `auditoria_ts_idx` ON `auditoria` (`ts`);--> statement-breakpoint
CREATE INDEX `auditoria_accion_idx` ON `auditoria` (`accion`);--> statement-breakpoint
CREATE INDEX `orden_items_orden_idx` ON `orden_items` (`orden_id`);--> statement-breakpoint
CREATE INDEX `ordenes_user_idx` ON `ordenes` (`user_id`);--> statement-breakpoint
CREATE INDEX `producto_imagenes_producto_idx` ON `producto_imagenes` (`producto_id`);--> statement-breakpoint
CREATE INDEX `productos_categoria_idx` ON `productos` (`categoria_id`);--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `twoFactor_secret_idx` ON `two_factor` (`secret`);--> statement-breakpoint
CREATE INDEX `twoFactor_userId_idx` ON `two_factor` (`user_id`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);