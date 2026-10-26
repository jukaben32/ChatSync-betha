-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "important" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unread" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Sequence" ADD COLUMN     "folder" VARCHAR(64),
ADD COLUMN     "matchType" VARCHAR(16) NOT NULL DEFAULT 'contains';

-- CreateTable
CREATE TABLE "AudienceList" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudienceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudienceListMember" (
    "listId" UUID NOT NULL,
    "subscriberId" UUID NOT NULL,
    "addedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudienceListMember_pkey" PRIMARY KEY ("listId","subscriberId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AudienceList_name_key" ON "AudienceList"("name");

-- CreateIndex
CREATE INDEX "AudienceListMember_subscriberId_idx" ON "AudienceListMember"("subscriberId");

-- AddForeignKey
ALTER TABLE "AudienceListMember" ADD CONSTRAINT "AudienceListMember_listId_fkey" FOREIGN KEY ("listId") REFERENCES "AudienceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudienceListMember" ADD CONSTRAINT "AudienceListMember_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "Subscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "AudienceList" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AudienceListMember" ENABLE ROW LEVEL SECURITY;
