-- CreateTable
CREATE TABLE "user_preferences" (
    "id" UUID NOT NULL,
    "user_id" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "dob" DATE NOT NULL,
    "current_country" VARCHAR(100) NOT NULL,
    "nationality" VARCHAR(100) NOT NULL,
    "visa_history" BOOLEAN,
    "degree_level" VARCHAR(100) NOT NULL,
    "intended_major" VARCHAR(100),
    "gpa" VARCHAR(50) NOT NULL,
    "annual_budget" DECIMAL(12,2) NOT NULL,
    "financial_aid" VARCHAR(100) NOT NULL,
    "destinations" TEXT[],
    "english_test" VARCHAR(50),
    "english_score" VARCHAR(50),
    "academic_test" VARCHAR(50),
    "academic_score" VARCHAR(50),
    "extracurriculars" TEXT[],
    "work_experience" VARCHAR(100),
    "industry" VARCHAR(100),
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "user_preferences"("user_id");

-- CreateIndex
CREATE INDEX "user_preferences_user_id_idx" ON "user_preferences"("user_id");
