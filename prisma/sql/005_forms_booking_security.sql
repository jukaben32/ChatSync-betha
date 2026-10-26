-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "nudges" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN     "clickedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BroadcastRecipient" ADD COLUMN     "clickedAt" TIMESTAMPTZ,
ADD COLUMN     "clickedButton" VARCHAR(64);

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "passwordHash" VARCHAR(255);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Form" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "keyword" VARCHAR(128),
    "intro" TEXT,
    "doneMessage" TEXT NOT NULL DEFAULT '¡Gracias! Hemos recibido tus respuestas.',
    "questions" JSONB NOT NULL DEFAULT '[]',
    "labelOnDone" VARCHAR(128),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sequenceId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" UUID NOT NULL,
    "formId" UUID NOT NULL,
    "subscriberId" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" UUID NOT NULL,
    "subscriberId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ NOT NULL,
    "endsAt" TIMESTAMPTZ NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'booked',
    "title" VARCHAR(255),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginLog" (
    "id" UUID NOT NULL,
    "actor" VARCHAR(255) NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "ip" VARCHAR(64),
    "ok" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeChunk_sourceId_idx" ON "KnowledgeChunk"("sourceId");

-- CreateIndex
CREATE INDEX "FormSubmission_formId_createdAt_idx" ON "FormSubmission"("formId", "createdAt");

-- CreateIndex
CREATE INDEX "Appointment_startsAt_idx" ON "Appointment"("startsAt");

-- CreateIndex
CREATE INDEX "Appointment_subscriberId_idx" ON "Appointment"("subscriberId");

-- CreateIndex
CREATE INDEX "LoginLog_createdAt_idx" ON "LoginLog"("createdAt");

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Una sola cita activa por hora de inicio (evita reservas dobles aunque dos clientes elijan a la vez)
CREATE UNIQUE INDEX "Appointment_startsAt_booked_key" ON "Appointment"("startsAt") WHERE "status" = 'booked';

ALTER TABLE "KnowledgeChunk" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Form" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FormSubmission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoginLog" ENABLE ROW LEVEL SECURITY;
