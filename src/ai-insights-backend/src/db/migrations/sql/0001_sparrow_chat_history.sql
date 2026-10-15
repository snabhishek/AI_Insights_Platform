CREATE TABLE "sparrow_chat_messages" (
	"project_id" varchar(50) NOT NULL,
	"conversation_id" varchar(100) NOT NULL,
	"id" varchar(100) NOT NULL,
	"request_id" varchar(100) NOT NULL,
	"position" bigserial NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sparrow_chat_messages_project_id_conversation_id_id_pk" PRIMARY KEY("project_id","conversation_id","id")
);
--> statement-breakpoint
CREATE TABLE "sparrow_chat_sessions" (
	"project_id" varchar(50) NOT NULL,
	"id" varchar(100) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sparrow_chat_sessions_project_id_id_pk" PRIMARY KEY("project_id","id")
);
--> statement-breakpoint
ALTER TABLE "sparrow_chat_messages" ADD CONSTRAINT "sparrow_chat_messages_project_id_conversation_id_sparrow_chat_sessions_project_id_id_fk" FOREIGN KEY ("project_id","conversation_id") REFERENCES "sparrow_chat_sessions"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sparrow_chat_sessions" ADD CONSTRAINT "sparrow_chat_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sparrow_chat_messages_order_idx" ON "sparrow_chat_messages" USING btree ("project_id","conversation_id","position");
