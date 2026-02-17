CREATE TABLE `agent_instance` (
	`id` text PRIMARY KEY,
	`workspace_session_id` text NOT NULL,
	`agent_definition_id` text NOT NULL,
	`session_id` text,
	`parent_instance_id` text,
	`position_x` integer DEFAULT 0 NOT NULL,
	`position_y` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'idle' NOT NULL,
	`error_message` text,
	`time_last_active` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_agent_instance_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `agent_instance_workspace_idx` ON `agent_instance` (`workspace_session_id`);--> statement-breakpoint
CREATE INDEX `agent_instance_parent_idx` ON `agent_instance` (`parent_instance_id`);--> statement-breakpoint
CREATE INDEX `agent_instance_session_idx` ON `agent_instance` (`session_id`);
