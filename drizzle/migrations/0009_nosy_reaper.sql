ALTER TABLE "media" ADD COLUMN "idea_id" uuid;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_idea_id_ideas_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;