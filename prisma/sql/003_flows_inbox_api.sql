-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "followUpAt" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "Sequence" ADD COLUMN     "stopOnReply" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "triggerLabel" VARCHAR(128);

-- AlterTable
ALTER TABLE "SubscriberSequence" ADD COLUMN     "status" VARCHAR(16) NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN     "buttons" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "mediaUrl" VARCHAR(1024);

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "scopes" TEXT[];

-- CreateTable
CREATE TABLE "CustomFieldDef" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "type" VARCHAR(16) NOT NULL DEFAULT 'text',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomFieldDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "CannedResponse" (
    "id" UUID NOT NULL,
    "shortcut" VARCHAR(64) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CannedResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowSession" (
    "id" UUID NOT NULL,
    "subscriberId" UUID NOT NULL,
    "sequenceId" UUID NOT NULL,
    "awaitingOrder" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "FlowSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboundWorkflow" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "phonePath" VARCHAR(128) NOT NULL DEFAULT 'phone',
    "templateName" VARCHAR(255),
    "language" VARCHAR(16) NOT NULL DEFAULT 'es',
    "text" TEXT,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "actions" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastPayload" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiLog" (
    "id" UUID NOT NULL,
    "keyName" VARCHAR(64),
    "method" VARCHAR(8) NOT NULL,
    "path" VARCHAR(255) NOT NULL,
    "status" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDef_key_key" ON "CustomFieldDef"("key");

-- CreateIndex
CREATE UNIQUE INDEX "CannedResponse_shortcut_key" ON "CannedResponse"("shortcut");

-- CreateIndex
CREATE INDEX "FlowSession_subscriberId_status_idx" ON "FlowSession"("subscriberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InboundWorkflow_token_key" ON "InboundWorkflow"("token");

-- CreateIndex
CREATE INDEX "ApiLog_createdAt_idx" ON "ApiLog"("createdAt");

-- AddForeignKey
ALTER TABLE "FlowSession" ADD CONSTRAINT "FlowSession_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowSession" ADD CONSTRAINT "FlowSession_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row Level Security en tablas nuevas
ALTER TABLE "CustomFieldDef" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Setting" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CannedResponse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FlowSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboundWorkflow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiLog" ENABLE ROW LEVEL SECURITY;
