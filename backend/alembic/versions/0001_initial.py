"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSON

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # users
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(100), nullable=False, unique=True, index=True),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("role", sa.String(20), default="counselor"),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )

    # sites
    op.create_table(
        "sites",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("address", sa.String(255), nullable=False),
        sa.Column("region_code", sa.String(10)),
        sa.Column("total_units", sa.Integer, default=0),
        sa.Column("description", sa.Text),
        sa.Column("status", sa.String(20), default="planning"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )

    # announcements
    op.create_table(
        "announcements",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("site_id", sa.Integer, sa.ForeignKey("sites.id"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("announcement_no", sa.String(50), unique=True),
        sa.Column("application_start", sa.DateTime(timezone=True)),
        sa.Column("application_end", sa.DateTime(timezone=True)),
        sa.Column("winner_announce_date", sa.DateTime(timezone=True)),
        sa.Column("contract_start", sa.DateTime(timezone=True)),
        sa.Column("contract_end", sa.DateTime(timezone=True)),
        sa.Column("eligibility_rules", JSON, default={}),
        sa.Column("supply_summary", JSON, default={}),
        sa.Column("raw_document_path", sa.String(500)),
        sa.Column("status", sa.String(20), default="draft"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )

    # announcement_supply_types
    op.create_table(
        "announcement_supply_types",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("announcement_id", sa.Integer, sa.ForeignKey("announcements.id"), nullable=False),
        sa.Column("supply_type", sa.String(50), nullable=False),
        sa.Column("unit_type", sa.String(20)),
        sa.Column("total_units", sa.Integer, default=0),
        sa.Column("price", sa.Numeric(15, 0)),
        sa.Column("area_sqm", sa.Numeric(8, 2)),
        sa.Column("specific_rules", JSON, default={}),
    )

    # customers
    op.create_table(
        "customers",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("site_id", sa.Integer, sa.ForeignKey("sites.id"), nullable=False),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("rrn_front", sa.String(6), nullable=False),
        sa.Column("rrn_back_hash", sa.String(255), nullable=False),
        sa.Column("phone", sa.String(20)),
        sa.Column("email", sa.String(100)),
        sa.Column("address", sa.String(255)),
        sa.Column("address_detail", sa.String(100)),
        sa.Column("no_home_years", sa.Integer, default=0),
        sa.Column("dependents_count", sa.Integer, default=0),
        sa.Column("subscription_months", sa.Integer, default=0),
        sa.Column("is_first_time_buyer", sa.Boolean, default=False),
        sa.Column("is_newlywed", sa.Boolean, default=False),
        sa.Column("marriage_date", sa.Date),
        sa.Column("income_monthly", sa.Numeric(12, 0)),
        sa.Column("current_region", sa.String(50)),
        sa.Column("region_residence_years", sa.Integer, default=0),
        sa.Column("score_no_home", sa.Integer, default=0),
        sa.Column("score_dependents", sa.Integer, default=0),
        sa.Column("score_subscription", sa.Integer, default=0),
        sa.Column("total_score", sa.Integer, default=0),
        sa.Column("notes", sa.Text),
        sa.Column("status", sa.String(20), default="inquiry"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )

    # winners
    op.create_table(
        "winners",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("announcement_id", sa.Integer, sa.ForeignKey("announcements.id"), nullable=False),
        sa.Column("customer_id", sa.Integer, sa.ForeignKey("customers.id"), nullable=False),
        sa.Column("unit_number", sa.String(20), nullable=False),
        sa.Column("building_no", sa.String(10)),
        sa.Column("unit_no", sa.String(10)),
        sa.Column("unit_type", sa.String(20)),
        sa.Column("supply_type", sa.String(50)),
        sa.Column("winning_score", sa.Integer),
        sa.Column("is_preliminary", sa.Boolean, default=False),
        sa.Column("preliminary_rank", sa.Integer),
        sa.Column("doc_review_status", sa.String(20), default="pending"),
        sa.Column("doc_review_result", JSON, default={}),
        sa.Column("doc_reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("doc_reviewed_by", sa.Integer, sa.ForeignKey("users.id")),
        sa.Column("contract_intent", sa.String(20)),
        sa.Column("contract_intent_at", sa.DateTime(timezone=True)),
        sa.Column("external_data", JSON, default={}),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )

    # documents
    op.create_table(
        "documents",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("customer_id", sa.Integer, sa.ForeignKey("customers.id"), nullable=False),
        sa.Column("doc_type", sa.String(50), nullable=False),
        sa.Column("file_path", sa.String(500), nullable=False),
        sa.Column("original_filename", sa.String(255)),
        sa.Column("file_size_bytes", sa.Integer),
        sa.Column("mime_type", sa.String(50)),
        sa.Column("ocr_status", sa.String(20), default="pending"),
        sa.Column("ocr_raw_text", sa.Text),
        sa.Column("ocr_extracted_data", JSON, default={}),
        sa.Column("ocr_confidence", sa.Integer),
        sa.Column("ocr_processed_at", sa.DateTime(timezone=True)),
        sa.Column("ai_analysis", JSON, default={}),
        sa.Column("ai_flags", JSON, default=[]),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("uploaded_by", sa.Integer, sa.ForeignKey("users.id")),
    )

    # document_reviews
    op.create_table(
        "document_reviews",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("document_id", sa.Integer, sa.ForeignKey("documents.id"), nullable=False),
        sa.Column("winner_id", sa.Integer, sa.ForeignKey("winners.id")),
        sa.Column("verdict", sa.String(20), nullable=False),
        sa.Column("check_results", JSON, default={}),
        sa.Column("issues", JSON, default=[]),
        sa.Column("supplement_required", JSON, default=[]),
        sa.Column("is_auto_review", sa.Boolean, default=True),
        sa.Column("reviewed_by", sa.Integer, sa.ForeignKey("users.id")),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # contracts
    op.create_table(
        "contracts",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("customer_id", sa.Integer, sa.ForeignKey("customers.id"), nullable=False),
        sa.Column("winner_id", sa.Integer, sa.ForeignKey("winners.id"), nullable=False),
        sa.Column("site_id", sa.Integer, sa.ForeignKey("sites.id"), nullable=False),
        sa.Column("contract_no", sa.String(50), unique=True),
        sa.Column("unit_number", sa.String(20), nullable=False),
        sa.Column("unit_type", sa.String(20)),
        sa.Column("supply_price", sa.Numeric(15, 0)),
        sa.Column("balcony_option_price", sa.Numeric(15, 0), default=0),
        sa.Column("other_options_price", sa.Numeric(15, 0), default=0),
        sa.Column("total_price", sa.Numeric(15, 0)),
        sa.Column("payment_schedule", JSON, default=[]),
        sa.Column("special_terms", sa.Text),
        sa.Column("status", sa.String(20), default="draft"),
        sa.Column("draft_pdf_path", sa.String(500)),
        sa.Column("signed_pdf_path", sa.String(500)),
        sa.Column("customer_copy_path", sa.String(500)),
        sa.Column("review_status", sa.String(20), default="pending"),
        sa.Column("review_result", JSON, default={}),
        sa.Column("review_version", sa.Integer, default=0),
        sa.Column("signed_at", sa.DateTime(timezone=True)),
        sa.Column("signed_by_customer", sa.Boolean, default=False),
        sa.Column("signed_by_counselor", sa.Boolean, default=False),
        sa.Column("deposit_confirmed", sa.Boolean, default=False),
        sa.Column("deposit_confirmed_at", sa.DateTime(timezone=True)),
        sa.Column("deposit_amount", sa.Numeric(15, 0)),
        sa.Column("created_by", sa.Integer, sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), onupdate=sa.func.now()),
    )

    # contract_signatures
    op.create_table(
        "contract_signatures",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("contract_id", sa.Integer, sa.ForeignKey("contracts.id"), nullable=False),
        sa.Column("signer_type", sa.String(20), nullable=False),
        sa.Column("signer_name", sa.String(50)),
        sa.Column("signer_rrn_front", sa.String(6)),
        sa.Column("signature_image_path", sa.String(500)),
        sa.Column("signature_data", sa.Text),
        sa.Column("ip_address", sa.String(45)),
        sa.Column("user_agent", sa.String(255)),
        sa.Column("signed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("signature_hash", sa.String(64)),
    )


def downgrade() -> None:
    op.drop_table("contract_signatures")
    op.drop_table("contracts")
    op.drop_table("document_reviews")
    op.drop_table("documents")
    op.drop_table("winners")
    op.drop_table("customers")
    op.drop_table("announcement_supply_types")
    op.drop_table("announcements")
    op.drop_table("sites")
    op.drop_table("users")
