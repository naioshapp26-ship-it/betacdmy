--
-- PostgreSQL database dump
--


-- Dumped from database version 17.7 (Debian 17.7-3.pgdg13+1)
-- Dumped by pg_dump version 17.9

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--



--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--



--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: auto_generate_blog_slug(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.auto_generate_blog_slug() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := generate_blog_slug(NEW.title);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: generate_blog_slug(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.generate_blog_slug(title text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  -- Convert to lowercase, replace special chars with hyphens, remove multiple hyphens
  base_slug := lower(regexp_replace(
    regexp_replace(
      regexp_replace(title, '[^a-zA-Z0-9\s-]', '', 'g'),
      '\s+', '-', 'g'
    ),
    '-+', '-', 'g'
  ));
  
  -- Trim hyphens from start and end
  base_slug := trim(both '-' from base_slug);
  
  -- Limit length to 100 characters
  base_slug := substring(base_slug from 1 for 100);
  
  final_slug := base_slug;
  
  -- Check for uniqueness and append counter if needed
  WHILE EXISTS (SELECT 1 FROM blog_posts WHERE slug = final_slug) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;
  
  RETURN final_slug;
END;
$$;


--
-- Name: generate_subscription_price_snapshot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.generate_subscription_price_snapshot() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- On insert or when locked_amount changes, create a price snapshot for audit trail
  IF (TG_OP = 'INSERT' OR 
      (TG_OP = 'UPDATE' AND (NEW.locked_amount IS DISTINCT FROM OLD.locked_amount OR 
                             NEW.locked_currency IS DISTINCT FROM OLD.locked_currency))) THEN
    NEW.price_snapshot = jsonb_build_object(
      'locked_amount', NEW.locked_amount,
      'locked_currency', NEW.locked_currency,
      'billing_cycle', NEW.billing_cycle,
      'plan_code', NEW.plan,
      'plan_id', NEW.plan_id,
      'snapshot_at', NOW(),
      'stripe_subscription_id', NEW.stripe_subscription_id
    );
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: get_user_permissions(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id uuid) RETURNS TABLE(permission_name text, resource text, action text, role_name text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    p.name,
    p.resource,
    p.action,
    r.name
  FROM user_roles ur
  JOIN roles r ON ur.role_id = r.id
  JOIN role_permissions rp ON r.id = rp.role_id
  JOIN permissions p ON rp.permission_id = p.id
  WHERE ur.user_id = p_user_id
    AND ur.is_active = true
    AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
  ORDER BY p.resource, p.action;
END;
$$;


--
-- Name: FUNCTION get_user_permissions(p_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_user_permissions(p_user_id uuid) IS 'Get all permissions for a user';


--
-- Name: get_user_roles(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.get_user_roles(p_user_id uuid) RETURNS TABLE(role_id uuid, role_name text, display_name text, assigned_at timestamp with time zone, expires_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.name,
    r.display_name,
    ur.assigned_at,
    ur.expires_at
  FROM user_roles ur
  JOIN roles r ON ur.role_id = r.id
  WHERE ur.user_id = p_user_id
    AND ur.is_active = true
    AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
  ORDER BY ur.assigned_at DESC;
END;
$$;


--
-- Name: FUNCTION get_user_roles(p_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_user_roles(p_user_id uuid) IS 'Get all roles for a user';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Some legacy tables may not have an updated_at column.
  -- Avoid runtime errors by setting it only when present.
  IF to_jsonb(NEW) ? 'updated_at' THEN
    NEW := jsonb_populate_record(NEW, jsonb_build_object('updated_at', NOW()));
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: update_central_seo_settings_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.update_central_seo_settings_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_payment_refunds_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.update_payment_refunds_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_seo_overrides_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.update_seo_overrides_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$;


--
-- Name: update_seo_settings_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.update_seo_settings_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


--
-- Name: user_has_permission(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id uuid, p_permission_name text) RETURNS boolean
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
  has_perm BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = p_user_id
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      AND p.name = p_permission_name
  ) INTO has_perm;
  
  RETURN has_perm;
END;
$$;


--
-- Name: FUNCTION user_has_permission(p_user_id uuid, p_permission_name text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.user_has_permission(p_user_id uuid, p_permission_name text) IS 'Check if a user has a specific permission';


--
-- Name: validate_subscription_locked_pricing(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION public.validate_subscription_locked_pricing() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- For new or updated subscriptions, ensure locked_amount is set
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    -- If status is active, locked_amount must not be null
    IF NEW.status = 'active' AND NEW.locked_amount IS NULL THEN
      RAISE EXCEPTION 'Active subscriptions must have locked_amount set (agreed price at signup)';
    END IF;
    
    -- If locked_amount is set, locked_currency must be set
    IF NEW.locked_amount IS NOT NULL AND NEW.locked_currency IS NULL THEN
      RAISE EXCEPTION 'Subscriptions with locked_amount must have locked_currency set';
    END IF;
    
    -- If plan_id is null, try to backfill from plan code
    IF NEW.plan_id IS NULL AND NEW.plan IS NOT NULL THEN
      SELECT id INTO NEW.plan_id 
      FROM subscription_plans 
      WHERE code = NEW.plan 
      LIMIT 1;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ad_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: ads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    category_id uuid,
    price numeric(10,2),
    location text,
    contact_name text,
    contact_phone text,
    contact_email text,
    image_url text,
    media_type text DEFAULT 'image'::text,
    media_url text,
    gallery jsonb DEFAULT '[]'::jsonb,
    status text DEFAULT 'DRAFT'::text NOT NULL,
    is_featured boolean DEFAULT false,
    publish_date date,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: ads_announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ads_announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    text text NOT NULL,
    enabled boolean DEFAULT true,
    show_in_top_bar boolean DEFAULT true,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    text_en text DEFAULT ''::text NOT NULL,
    text_ar text DEFAULT ''::text NOT NULL
);


--
-- Name: ads_display_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ads_display_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hero_title text,
    hero_subtitle text,
    search_placeholder text,
    stat_ads_label text,
    stat_users_label text,
    stat_satisfaction_label text,
    stat_support_label text,
    stat_support_value text DEFAULT '24/7'::text,
    homepage_promo_enabled boolean DEFAULT false,
    homepage_promo_type text DEFAULT 'image'::text,
    homepage_promo_media_url text,
    homepage_promo_link text,
    homepage_promo_title text,
    homepage_promo_subtitle text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: ai_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_config (
    id integer DEFAULT 1 NOT NULL,
    ai_enabled boolean DEFAULT false NOT NULL,
    ai_provider character varying(50) DEFAULT 'gemini'::character varying NOT NULL,
    ai_model character varying(100) DEFAULT 'gemini-2.5-flash'::character varying NOT NULL,
    api_key bytea,
    api_secret bytea,
    max_tokens integer DEFAULT 4096 NOT NULL,
    temperature numeric(3,2) DEFAULT 0.7 NOT NULL,
    custom_config jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    CONSTRAINT ai_config_single_row CHECK ((id = 1))
);


--
-- Name: TABLE ai_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ai_config IS 'AI provider configuration for tenant - allows each tenant to configure their own AI integration';


--
-- Name: COLUMN ai_config.api_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_config.api_key IS 'Encrypted API key using pgp_sym_encrypt';


--
-- Name: COLUMN ai_config.api_secret; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_config.api_secret IS 'Encrypted API secret/additional credential using pgp_sym_encrypt';


--
-- Name: COLUMN ai_config.custom_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_config.custom_config IS 'Additional provider-specific configuration as JSON';


--
-- Name: assignment_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assignment_submissions (
    id uuid NOT NULL,
    student_id uuid,
    instructor_id uuid,
    course_id uuid,
    assignment_id uuid,
    item_id text,
    submission_type text NOT NULL,
    prompt text,
    rubric text,
    answer text,
    status text DEFAULT 'PENDING'::text NOT NULL,
    score numeric(5,2),
    feedback text,
    graded_by uuid,
    graded_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: attendance_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    course_id uuid,
    session_date date NOT NULL,
    status text NOT NULL,
    duration_seconds integer DEFAULT 0 NOT NULL,
    items_completed integer DEFAULT 0 NOT NULL,
    milestone_events integer DEFAULT 0 NOT NULL,
    last_active timestamp with time zone DEFAULT now()
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    user_id uuid,
    user_email character varying(255),
    action character varying(100) NOT NULL,
    resource_type character varying(50) NOT NULL,
    resource_id character varying(255),
    ip_address inet,
    user_agent text,
    status character varying(20) DEFAULT 'success'::character varying NOT NULL,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb,
    state_before jsonb,
    state_after jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_logs_status_valid CHECK (((status)::text = ANY ((ARRAY['success'::character varying, 'failure'::character varying, 'error'::character varying])::text[])))
);


--
-- Name: TABLE audit_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_logs IS 'Central audit trail for all privileged and sensitive operations across the platform';


--
-- Name: COLUMN audit_logs.action; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_logs.action IS 'Format: resource.action (e.g., tenant.create, user.delete, subscription.upgrade)';


--
-- Name: COLUMN audit_logs.state_before; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_logs.state_before IS 'JSON snapshot of resource state before the operation';


--
-- Name: COLUMN audit_logs.state_after; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_logs.state_after IS 'JSON snapshot of resource state after the operation';


--
-- Name: blog_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blog_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    excerpt text NOT NULL,
    content text NOT NULL,
    author text NOT NULL,
    image text NOT NULL,
    published_on date NOT NULL,
    is_featured boolean DEFAULT false,
    status text DEFAULT 'PUBLISHED'::text NOT NULL,
    category text DEFAULT 'Technology'::text,
    video_url text,
    uploaded_image_path text,
    uploaded_video_path text,
    slug text NOT NULL
);


--
-- Name: career_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.career_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id text NOT NULL,
    job_title text NOT NULL,
    applicant_name text NOT NULL,
    applicant_email text NOT NULL,
    applicant_phone text,
    resume_url text,
    cover_letter text,
    job_snapshot jsonb,
    status text DEFAULT 'SUBMITTED'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    resume_file_path text
);


--
-- Name: central_live_platform_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.central_live_platform_config (
    id integer NOT NULL,
    smrrtx_enabled boolean DEFAULT true NOT NULL,
    smrrtx_permanent_room_link text,
    zoom_enabled boolean DEFAULT false NOT NULL,
    zoom_config_link text,
    zoom_client_id text,
    zoom_client_secret text,
    zoom_account_id text,
    zoom_user_id text,
    meet_enabled boolean DEFAULT false NOT NULL,
    meet_config_link text,
    google_sa_email text,
    google_sa_key text,
    google_calendar_id text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: central_schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.central_schema_migrations (
    filename text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: central_seo_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.central_seo_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    page_path character varying(255) NOT NULL,
    title_en character varying(255),
    title_ar character varying(255),
    description_en text,
    description_ar text,
    keywords_en text,
    keywords_ar text,
    canonical_url text,
    robots character varying(255),
    indexable boolean DEFAULT true,
    og_title_en character varying(255),
    og_title_ar character varying(255),
    og_description_en text,
    og_description_ar text,
    og_image_url text,
    og_type character varying(100),
    og_site_name character varying(255),
    twitter_card character varying(100),
    twitter_title_en character varying(255),
    twitter_title_ar character varying(255),
    twitter_description_en text,
    twitter_description_ar text,
    twitter_image_url text,
    jsonld_en text,
    jsonld_ar text,
    locale character varying(100),
    locale_alternate character varying(255),
    sitemap_priority numeric(3,2),
    sitemap_changefreq character varying(50),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_by uuid
);


--
-- Name: certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.certificates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    course_id uuid,
    issue_date date NOT NULL,
    certification_number text NOT NULL,
    type text NOT NULL,
    course_level text,
    url text
);


--
-- Name: conversation_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid,
    user_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now(),
    left_at timestamp with time zone
);


--
-- Name: course_categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: course_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    receipt_id text NOT NULL,
    student_id uuid NOT NULL,
    student_name text,
    student_email text,
    course_id uuid NOT NULL,
    course_title text,
    instructor_name text,
    instructor_id uuid,
    course_price numeric(10,2) DEFAULT 0 NOT NULL,
    amount numeric(10,2) NOT NULL,
    payment_method text NOT NULL,
    collected_by text,
    collected_by_id uuid,
    notes text,
    stripe_session_id text,
    stripe_payment_intent_id text,
    receipt_url text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT course_payments_amount_check CHECK ((amount >= (0)::numeric))
);


--
-- Name: COLUMN course_payments.stripe_session_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_payments.stripe_session_id IS 'Stripe checkout session ID for online payments';


--
-- Name: COLUMN course_payments.stripe_payment_intent_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_payments.stripe_payment_intent_id IS 'Stripe payment intent ID for tracking payment status';


--
-- Name: COLUMN course_payments.receipt_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.course_payments.receipt_url IS 'Stripe-generated receipt URL for customer download';


--
-- Name: course_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    course_id uuid,
    completed_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_items integer DEFAULT 0 NOT NULL,
    completed_count integer DEFAULT 0 NOT NULL,
    progress_percent numeric(5,2) DEFAULT 0 NOT NULL,
    last_activity timestamp with time zone DEFAULT now(),
    pre_test_completed boolean DEFAULT false,
    post_test_completed boolean DEFAULT false,
    pre_test_score numeric(5,2),
    post_test_score numeric(5,2)
);


--
-- Name: courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    instructor text NOT NULL,
    level text NOT NULL,
    price numeric(10,2) NOT NULL,
    thumbnail text NOT NULL,
    modules jsonb DEFAULT '[]'::jsonb NOT NULL,
    sync_sessions text[] DEFAULT ARRAY[]::text[],
    duration numeric(10,1),
    pre_course_test jsonb,
    post_course_test jsonb,
    created_at timestamp with time zone DEFAULT now(),
    category text DEFAULT 'Technology'::text,
    created_by uuid,
    language character varying(10) DEFAULT 'en'::character varying,
    status character varying(20) DEFAULT 'draft'::character varying,
    target_audience text,
    prerequisites text,
    learning_outcomes text,
    CONSTRAINT courses_language_check CHECK (((language)::text = ANY ((ARRAY['en'::character varying, 'ar'::character varying, 'fr'::character varying, 'es'::character varying])::text[]))),
    CONSTRAINT courses_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'published'::character varying])::text[])))
);


--
-- Name: COLUMN courses.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.courses.created_by IS 'User who created this course';


--
-- Name: credit_redemption_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_redemption_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    type text NOT NULL,
    description text,
    required_credits integer NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    is_active boolean DEFAULT true,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: credit_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    option_id uuid,
    credits_spent integer NOT NULL,
    status text DEFAULT 'COMPLETED'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: credit_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    actor_id uuid,
    amount integer NOT NULL,
    action_type text NOT NULL,
    source text NOT NULL,
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: discounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    percentage integer NOT NULL,
    course_id uuid,
    created_by text NOT NULL,
    expiry_date date NOT NULL,
    usage_count integer DEFAULT 0
);


--
-- Name: email_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope character varying(20) NOT NULL,
    tenant_id uuid,
    smtp_host character varying(255) NOT NULL,
    smtp_port integer DEFAULT 587 NOT NULL,
    smtp_user character varying(255) NOT NULL,
    smtp_pass text NOT NULL,
    smtp_from character varying(255) NOT NULL,
    smtp_secure boolean DEFAULT false NOT NULL,
    created_by character varying(255),
    updated_by character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT email_settings_port_valid CHECK (((smtp_port > 0) AND (smtp_port <= 65535))),
    CONSTRAINT email_settings_scope_tenant_valid CHECK (((((scope)::text = 'central'::text) AND (tenant_id IS NULL)) OR (((scope)::text = 'tenant'::text) AND (tenant_id IS NOT NULL)))),
    CONSTRAINT email_settings_scope_valid CHECK (((scope)::text = ANY ((ARRAY['central'::character varying, 'tenant'::character varying])::text[])))
);


--
-- Name: enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    course_id uuid,
    enrolled_at timestamp with time zone DEFAULT now()
);


--
-- Name: freelancer_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.freelancer_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    full_name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    country text NOT NULL,
    field_of_expertise text NOT NULL,
    years_of_experience integer DEFAULT 0 NOT NULL,
    short_bio text NOT NULL,
    cv_url text,
    status text DEFAULT 'NEW'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: instructor_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instructor_assignments (
    id uuid NOT NULL,
    instructor_id uuid,
    course_id text,
    title text NOT NULL,
    question text,
    rubric text,
    difficulty text,
    topic text,
    due_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: instructor_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instructor_payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    instructor_id uuid NOT NULL,
    instructor_name text NOT NULL,
    amount numeric(10,2) NOT NULL,
    payment_method text NOT NULL,
    course_id uuid,
    course_title text,
    reference text,
    notes text,
    recorded_by uuid,
    recorded_by_name text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT instructor_payouts_amount_check CHECK ((amount >= (0)::numeric))
);


--
-- Name: live_class_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_class_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    live_class_id uuid,
    student_id uuid,
    email text,
    invite_token text,
    status text DEFAULT 'INVITED'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: live_classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    instructor_id uuid,
    topic text NOT NULL,
    agenda text,
    start_time timestamp with time zone NOT NULL,
    platform text NOT NULL,
    provider_meeting_id text,
    host_url text NOT NULL,
    join_url text NOT NULL,
    passcode text,
    invite_type text DEFAULT 'all'::text NOT NULL,
    duration_minutes integer DEFAULT 60,
    status text DEFAULT 'SCHEDULED'::text NOT NULL,
    recording_url text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: live_platform_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_platform_config (
    id integer NOT NULL,
    smrrtx_enabled boolean DEFAULT true NOT NULL,
    smrrtx_permanent_room_link text,
    zoom_enabled boolean DEFAULT false NOT NULL,
    zoom_config_link text,
    meet_enabled boolean DEFAULT false NOT NULL,
    meet_config_link text,
    updated_at timestamp with time zone DEFAULT now(),
    zoom_client_id text,
    zoom_client_secret text,
    zoom_account_id text,
    zoom_user_id text,
    google_sa_email text,
    google_sa_key text,
    google_calendar_id text
);


--
-- Name: media_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    allow_direct_upload boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE media_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.media_settings IS 'Controls whether users can upload media directly or must use external links';


--
-- Name: COLUMN media_settings.tenant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.media_settings.tenant_id IS 'NULL for global setting, otherwise specific tenant ID';


--
-- Name: COLUMN media_settings.allow_direct_upload; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.media_settings.allow_direct_upload IS 'If true, allow direct media uploads. If false, only external links allowed';


--
-- Name: membership_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    email text NOT NULL,
    phone text NOT NULL,
    country text NOT NULL,
    membership_type text NOT NULL,
    status text DEFAULT 'PENDING_PAYMENT'::text NOT NULL,
    payment_status text DEFAULT 'pending'::text NOT NULL,
    payment_gateway text,
    payment_reference text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: message_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    action text NOT NULL,
    actor_id uuid,
    target_message_id uuid,
    target_user_id uuid,
    conversation_id uuid,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: message_blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_blocks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    blocked_by uuid,
    reason text,
    expires_at timestamp with time zone,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: message_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    course_id uuid,
    created_by uuid,
    type text NOT NULL,
    title text,
    is_muted boolean DEFAULT false,
    muted_until timestamp with time zone,
    muted_reason text,
    muted_by uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: message_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_participants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid,
    user_id uuid,
    role text NOT NULL,
    can_post boolean DEFAULT true,
    joined_at timestamp with time zone DEFAULT now()
);


--
-- Name: message_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid,
    user_id uuid,
    last_message_id uuid,
    last_read_at timestamp with time zone DEFAULT now()
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid,
    course_id uuid,
    sender_id uuid,
    target_user_id uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    deleted_by uuid,
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    message text NOT NULL,
    type text NOT NULL,
    read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    is_read boolean DEFAULT false,
    conversation_id uuid,
    target_message_id uuid,
    actor_id uuid,
    course_id uuid,
    category text DEFAULT 'SYSTEM'::text,
    metadata jsonb DEFAULT '{}'::jsonb,
    read_at timestamp with time zone
);


--
-- Name: payment_gateway_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_gateway_config (
    id integer DEFAULT 1 NOT NULL,
    stripe_enabled boolean DEFAULT false NOT NULL,
    stripe_public_key text,
    stripe_secret_key bytea,
    stripe_webhook_secret bytea,
    paypal_enabled boolean DEFAULT false NOT NULL,
    paypal_client_id text,
    paypal_secret_key bytea,
    visa_enabled boolean DEFAULT false NOT NULL,
    visa_public_key text,
    visa_secret_key bytea,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    stripe_price_basic_monthly text,
    stripe_price_basic_yearly text,
    stripe_price_pro_monthly text,
    stripe_price_pro_yearly text,
    stripe_price_enterprise_monthly text,
    stripe_price_enterprise_yearly text,
    plan_basic_monthly_amount numeric(10,2),
    plan_basic_monthly_currency character varying(10),
    plan_basic_yearly_amount numeric(10,2),
    plan_basic_yearly_currency character varying(10),
    plan_pro_monthly_amount numeric(10,2),
    plan_pro_monthly_currency character varying(10),
    plan_pro_yearly_amount numeric(10,2),
    plan_pro_yearly_currency character varying(10),
    plan_enterprise_monthly_amount numeric(10,2),
    plan_enterprise_monthly_currency character varying(10),
    plan_enterprise_yearly_amount numeric(10,2),
    plan_enterprise_yearly_currency character varying(10),
    CONSTRAINT payment_gateway_config_single_row CHECK ((id = 1))
);


--
-- Name: TABLE payment_gateway_config; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payment_gateway_config IS 'Payment gateway configuration for Super Admin (main domain only) - used for tenant signup/provisioning';


--
-- Name: COLUMN payment_gateway_config.stripe_secret_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_gateway_config.stripe_secret_key IS 'Encrypted Stripe secret key using pgp_sym_encrypt (BYTEA)';


--
-- Name: COLUMN payment_gateway_config.stripe_webhook_secret; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_gateway_config.stripe_webhook_secret IS 'Encrypted Stripe webhook secret using pgp_sym_encrypt';


--
-- Name: COLUMN payment_gateway_config.paypal_secret_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_gateway_config.paypal_secret_key IS 'Encrypted PayPal secret key using pgp_sym_encrypt (BYTEA)';


--
-- Name: COLUMN payment_gateway_config.visa_secret_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_gateway_config.visa_secret_key IS 'Encrypted Visa secret key using pgp_sym_encrypt (BYTEA)';


--
-- Name: COLUMN payment_gateway_config.plan_basic_monthly_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_gateway_config.plan_basic_monthly_amount IS 'Basic plan monthly amount in dollars (e.g., 29.99)';


--
-- Name: COLUMN payment_gateway_config.plan_basic_yearly_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_gateway_config.plan_basic_yearly_amount IS 'Basic plan yearly amount in dollars (e.g., 299.99)';


--
-- Name: COLUMN payment_gateway_config.plan_pro_monthly_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_gateway_config.plan_pro_monthly_amount IS 'Pro plan monthly amount in dollars (e.g., 49.99)';


--
-- Name: COLUMN payment_gateway_config.plan_pro_yearly_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_gateway_config.plan_pro_yearly_amount IS 'Pro plan yearly amount in dollars (e.g., 499.99)';


--
-- Name: COLUMN payment_gateway_config.plan_enterprise_monthly_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_gateway_config.plan_enterprise_monthly_amount IS 'Enterprise plan monthly amount in dollars (e.g., 99.99)';


--
-- Name: COLUMN payment_gateway_config.plan_enterprise_yearly_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_gateway_config.plan_enterprise_yearly_amount IS 'Enterprise plan yearly amount in dollars (e.g., 999.99)';


--
-- Name: payment_refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid NOT NULL,
    refund_id text NOT NULL,
    stripe_refund_id text,
    amount numeric(10,2) NOT NULL,
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    reason text,
    refunded_by uuid NOT NULL,
    refunded_by_name text NOT NULL,
    refunded_at timestamp with time zone DEFAULT now() NOT NULL,
    stripe_receipt_number text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_refunds_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT payment_refunds_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'succeeded'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: TABLE payment_refunds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payment_refunds IS 'Tracks refunds for course payments, supporting partial and full refunds';


--
-- Name: COLUMN payment_refunds.refund_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_refunds.refund_id IS 'Internal unique refund identifier for tracking';


--
-- Name: COLUMN payment_refunds.stripe_refund_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_refunds.stripe_refund_id IS 'Stripe refund ID for online payments';


--
-- Name: COLUMN payment_refunds.amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_refunds.amount IS 'Amount refunded in the specified currency';


--
-- Name: COLUMN payment_refunds.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_refunds.status IS 'Refund status: pending (Stripe processing), succeeded (completed), failed (error)';


--
-- Name: COLUMN payment_refunds.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_refunds.reason IS 'Admin-provided reason for the refund';


--
-- Name: COLUMN payment_refunds.refunded_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_refunds.refunded_by IS 'User ID of admin who processed the refund';


--
-- Name: COLUMN payment_refunds.refunded_by_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_refunds.refunded_by_name IS 'Cached admin name for audit trail';


--
-- Name: COLUMN payment_refunds.stripe_receipt_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_refunds.stripe_receipt_number IS 'Stripe-generated receipt number for refund';


--
-- Name: payment_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    subscription_id uuid,
    amount numeric(12,4) NOT NULL,
    currency character varying(3) DEFAULT 'USD'::character varying,
    status character varying(20),
    payment_method character varying(50),
    transaction_reference character varying(255),
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    refunded_amount numeric(12,4) DEFAULT 0,
    refund_status character varying(20),
    CONSTRAINT payment_transactions_refund_status_check CHECK (((refund_status)::text = ANY ((ARRAY['none'::character varying, 'partial'::character varying, 'full'::character varying])::text[])))
);


--
-- Name: COLUMN payment_transactions.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payment_transactions.updated_at IS 'Timestamp of last update (auto-managed by trigger)';


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    resource text NOT NULL,
    action text NOT NULL,
    description text,
    is_system boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE permissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.permissions IS 'System permissions for RBAC';


--
-- Name: provisioning_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.provisioning_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    subdomain character varying(63),
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    step character varying(100),
    message text,
    error_details jsonb,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT provisioning_logs_status_valid CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'running'::character varying, 'success'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: COLUMN provisioning_logs.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.provisioning_logs.created_at IS 'Timestamp when record was created';


--
-- Name: COLUMN provisioning_logs.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.provisioning_logs.updated_at IS 'Timestamp of last update (auto-managed by trigger)';


--
-- Name: rewards_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rewards_config (
    id integer NOT NULL,
    daily_login integer NOT NULL,
    lesson_completion integer NOT NULL,
    quiz_pass integer NOT NULL,
    assignment_submission integer NOT NULL,
    credits_per_currency_unit numeric(12,2) DEFAULT 3000 NOT NULL,
    currency_code text DEFAULT 'USD'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: rewards_config_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rewards_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rewards_config_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rewards_config_id_seq OWNED BY public.rewards_config.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE role_permissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.role_permissions IS 'Maps permissions to roles';


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    display_name text NOT NULL,
    description text,
    is_system boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.roles IS 'System roles for RBAC';


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    scope text NOT NULL,
    filename text NOT NULL,
    applied_at timestamp with time zone DEFAULT now()
);


--
-- Name: seo_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seo_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content_type character varying(50) NOT NULL,
    content_id uuid NOT NULL,
    title_en character varying(255),
    title_ar character varying(255),
    description_en text,
    description_ar text,
    keywords_en text,
    keywords_ar text,
    canonical_url text,
    robots character varying(255),
    indexable boolean DEFAULT true,
    og_title_en character varying(255),
    og_title_ar character varying(255),
    og_description_en text,
    og_description_ar text,
    og_image_url text,
    og_type character varying(100),
    og_site_name character varying(255),
    twitter_card character varying(100),
    twitter_title_en character varying(255),
    twitter_title_ar character varying(255),
    twitter_description_en text,
    twitter_description_ar text,
    twitter_image_url text,
    jsonld_en text,
    jsonld_ar text,
    locale character varying(100),
    locale_alternate character varying(255),
    sitemap_priority numeric(3,2),
    sitemap_changefreq character varying(50),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_by uuid
);


--
-- Name: seo_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seo_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    page_path character varying(255) NOT NULL,
    title_en character varying(255),
    title_ar character varying(255),
    description_en text,
    description_ar text,
    keywords_en text,
    keywords_ar text,
    canonical_url text,
    robots character varying(255),
    indexable boolean DEFAULT true,
    og_title_en character varying(255),
    og_title_ar character varying(255),
    og_description_en text,
    og_description_ar text,
    og_image_url text,
    og_type character varying(100),
    og_site_name character varying(255),
    twitter_card character varying(100),
    twitter_title_en character varying(255),
    twitter_title_ar character varying(255),
    twitter_description_en text,
    twitter_description_ar text,
    twitter_image_url text,
    jsonld_en text,
    jsonld_ar text,
    locale character varying(100),
    locale_alternate character varying(255),
    sitemap_priority numeric(3,2),
    sitemap_changefreq character varying(50),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    updated_by uuid
);


--
-- Name: static_pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.static_pages (
    slug text NOT NULL,
    title text,
    content text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: subscription_plan_prices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_plan_prices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    billing_cycle character varying(20) NOT NULL,
    amount numeric(10,2) NOT NULL,
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    valid_from timestamp with time zone NOT NULL,
    valid_to timestamp with time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT plan_prices_amount_positive CHECK ((amount >= (0)::numeric)),
    CONSTRAINT plan_prices_billing_cycle_valid CHECK (((billing_cycle)::text = ANY ((ARRAY['monthly'::character varying, 'yearly'::character varying])::text[]))),
    CONSTRAINT plan_prices_valid_dates CHECK (((valid_to IS NULL) OR (valid_from <= valid_to)))
);


--
-- Name: subscription_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    display_name character varying(255) NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: subscription_refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_transaction_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    refund_id character varying(100) NOT NULL,
    stripe_refund_id character varying(100),
    amount numeric(12,4) NOT NULL,
    currency character varying(3) DEFAULT 'USD'::character varying,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    reason character varying(255),
    refunded_by uuid,
    refunded_by_name character varying(255),
    refunded_by_email character varying(255),
    stripe_receipt_number character varying(100),
    metadata jsonb,
    refunded_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT subscription_refunds_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'succeeded'::character varying, 'failed'::character varying])::text[])))
);


--
-- Name: TABLE subscription_refunds; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.subscription_refunds IS 'Stores refund records for tenant subscription payments processed by super admin';


--
-- Name: COLUMN subscription_refunds.payment_transaction_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscription_refunds.payment_transaction_id IS 'Reference to the original payment transaction being refunded';


--
-- Name: COLUMN subscription_refunds.stripe_refund_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscription_refunds.stripe_refund_id IS 'Stripe refund ID if processed through Stripe';


--
-- Name: COLUMN subscription_refunds.refunded_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscription_refunds.refunded_by IS 'Super admin who processed the refund';


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    plan character varying(50) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying,
    price_monthly numeric(10,2),
    currency character varying(3) DEFAULT 'USD'::character varying,
    billing_cycle character varying(20) DEFAULT 'monthly'::character varying,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    locked_amount numeric(10,2) DEFAULT 0,
    locked_currency character varying(3) DEFAULT 'USD'::character varying,
    plan_id uuid,
    stripe_subscription_id character varying(255),
    price_snapshot jsonb,
    CONSTRAINT subscriptions_billing_cycle_valid CHECK (((billing_cycle)::text = ANY ((ARRAY['monthly'::character varying, 'yearly'::character varying])::text[]))),
    CONSTRAINT subscriptions_locked_currency_valid CHECK (((locked_currency)::text = ANY ((ARRAY['USD'::character varying, 'EUR'::character varying, 'GBP'::character varying, 'AED'::character varying, 'SAR'::character varying, 'EGP'::character varying])::text[]))),
    CONSTRAINT subscriptions_plan_valid CHECK (((plan)::text = ANY ((ARRAY['basic'::character varying, 'pro'::character varying, 'enterprise'::character varying])::text[]))),
    CONSTRAINT subscriptions_status_valid CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'cancelled'::character varying, 'expired'::character varying, 'past_due'::character varying, 'trialing'::character varying, 'pending'::character varying])::text[])))
);


--
-- Name: TABLE subscriptions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.subscriptions IS 'Subscription records with locked pricing. Each active tenant must have exactly one active subscription.';


--
-- Name: COLUMN subscriptions.price_monthly; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscriptions.price_monthly IS 'DEPRECATED: Legacy field. Use locked_amount instead.';


--
-- Name: COLUMN subscriptions.locked_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscriptions.locked_amount IS 'Price customer agreed to at signup. Never changes unless customer explicitly changes plan. Source of truth for billing.';


--
-- Name: COLUMN subscriptions.locked_currency; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscriptions.locked_currency IS 'Currency customer agreed to at signup.';


--
-- Name: COLUMN subscriptions.plan_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.subscriptions.plan_id IS 'Source of truth for subscription plan (FK to subscription_plans). Use this for runtime decisions.';


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying(255) NOT NULL,
    value text,
    value_type character varying(20) DEFAULT 'string'::character varying NOT NULL,
    category character varying(50) NOT NULL,
    description text,
    is_encrypted boolean DEFAULT false,
    is_public boolean DEFAULT false,
    validation_rules jsonb,
    default_value text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    updated_by uuid,
    CONSTRAINT system_settings_value_type_valid CHECK (((value_type)::text = ANY ((ARRAY['string'::character varying, 'number'::character varying, 'boolean'::character varying, 'json'::character varying, 'encrypted'::character varying])::text[])))
);


--
-- Name: TABLE system_settings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.system_settings IS 'Centralized key-value store for system-wide configuration';


--
-- Name: COLUMN system_settings.is_encrypted; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.system_settings.is_encrypted IS 'If true, value should be encrypted at rest (e.g., API keys, secrets)';


--
-- Name: COLUMN system_settings.is_public; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.system_settings.is_public IS 'If true, setting can be safely exposed to frontend/public API';


--
-- Name: COLUMN system_settings.validation_rules; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.system_settings.validation_rules IS 'JSON schema or validation rules to enforce value constraints';


--
-- Name: tenant_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_admins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    email character varying(255) NOT NULL,
    password character varying(255),
    first_name character varying(100),
    last_name character varying(100),
    phone character varying(50),
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    password_hash text,
    reset_token_hash text,
    reset_token_expires timestamp with time zone
);


--
-- Name: COLUMN tenant_admins.updated_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.tenant_admins.updated_at IS 'Timestamp of last update (auto-managed by trigger)';


--
-- Name: tenant_user_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenant_user_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    platform_user_id uuid NOT NULL,
    tenant_user_id uuid,
    role text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    revoked_at timestamp with time zone
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subdomain character varying(63) NOT NULL,
    company_name character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    subscription_plan character varying(50) NOT NULL,
    database_url_encrypted bytea NOT NULL,
    database_name character varying(63) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    activated_at timestamp with time zone,
    suspended_at timestamp with time zone,
    deleted_at timestamp with time zone,
    max_users integer,
    max_courses integer,
    storage_quota_gb integer,
    custom_domain character varying(255),
    settings jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT tenants_plan_valid CHECK (((subscription_plan)::text = ANY ((ARRAY['basic'::character varying, 'pro'::character varying, 'enterprise'::character varying])::text[]))),
    CONSTRAINT tenants_status_valid CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'deleted'::character varying, 'pending_payment'::character varying])::text[])))
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    course_id uuid,
    amount numeric(10,2) NOT NULL,
    transacted_on date NOT NULL,
    status text NOT NULL,
    method text NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    assigned_by uuid,
    assigned_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE user_roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_roles IS 'Assigns roles to users';


--
-- Name: users_public_user_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_public_user_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    password text,
    role text DEFAULT 'STUDENT'::text NOT NULL,
    avatar text,
    status text DEFAULT 'active'::text,
    phone text,
    join_date date,
    last_active timestamp with time zone,
    plan text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    enrolled_courses uuid[] DEFAULT ARRAY[]::uuid[],
    credits integer DEFAULT 0,
    streak integer DEFAULT 0,
    last_login_date date,
    notes text,
    progress jsonb,
    specialization text,
    bio text,
    years_of_experience integer,
    portfolio_url text,
    social_links jsonb,
    certifications jsonb,
    password_hash text,
    last_activity_date date,
    reset_token_hash text,
    reset_token_expires timestamp with time zone,
    national_id text,
    public_user_id text DEFAULT ('U-'::text || lpad((nextval('public.users_public_user_id_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
    phone_country_code text,
    gender text,
    follow_up_status text
);


--
-- Name: rewards_config id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rewards_config ALTER COLUMN id SET DEFAULT nextval('public.rewards_config_id_seq'::regclass);


--
-- Data for Name: ad_categories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ad_categories (id, name, created_at, updated_at) FROM stdin;
3f89a472-c541-4121-9e45-e2353ebd1f37	دورات	2026-03-16 13:07:03.607851+00	2026-03-16 13:07:03.607851+00
\.


--
-- Data for Name: ads; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ads (id, title, description, category_id, price, location, contact_name, contact_phone, contact_email, image_url, media_type, media_url, gallery, status, is_featured, publish_date, created_by, created_at, updated_at) FROM stdin;
3e5ea5f5-4d60-43e8-9385-6b3d7b7f809d	اعلان تجريبى	اعلان تجريبى	3f89a472-c541-4121-9e45-e2353ebd1f37	50.00	\N		2010	\N	/uploads/blog-images/image-1773754407862-66ef8c34-80ce-4a1a-9c0c-5bdf0c7251be.png	image	\N	[]	PUBLISHED	f	2026-03-16	ecfbd4c3-2eee-4237-883f-419f5d1558e3	2026-03-16 12:54:36.688874+00	2026-03-17 13:33:30.201132+00
5c5408e5-20dd-4003-bf76-d2eb2993c3e9	عرض لفترة محدودة	عرض لفترة محدودة	3f89a472-c541-4121-9e45-e2353ebd1f37	0.00	\N	\N	\N	\N		video	/uploads/blog-videos/video-1774530911735-8002fb12-ed26-4de8-a9ba-c9ec92ec9004.mp4	[{"id": "ad_media_fallback_image_dmk22", "url": "/uploads/blog-videos/video-1774530911735-8002fb12-ed26-4de8-a9ba-c9ec92ec9004.mp4", "order": 0, "mediaType": "video"}, {"id": "media_1774530971602_qi83mc", "url": "/uploads/blog-videos/video-1774530977945-a78a37d1-86dd-4b00-bdeb-3cff5dc68ead.mp4", "order": 1, "mediaType": "video"}]	PUBLISHED	f	2026-03-17	ecfbd4c3-2eee-4237-883f-419f5d1558e3	2026-03-17 10:00:30.804608+00	2026-03-26 13:20:48.986421+00
\.


--
-- Data for Name: ads_announcements; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ads_announcements (id, text, enabled, show_in_top_bar, sort_order, created_by, created_at, updated_at, text_en, text_ar) FROM stdin;
0fa7872c-d78d-413d-adfa-9dcc622251d5	launch your academy	t	t	0	ecfbd4c3-2eee-4237-883f-419f5d1558e3	2026-03-17 10:10:21.125704+00	2026-03-17 10:27:47.942359+00	launch your academy	أطلق أكاديميتك
e526ec2d-745c-4283-9b85-e08a58200fb7	Explore Our Courses	t	t	1	ecfbd4c3-2eee-4237-883f-419f5d1558e3	2026-03-17 10:22:23.425545+00	2026-03-17 10:28:17.704572+00	Explore Our Courses	استكشف دوراتنا
30e0b42b-b682-4112-9560-1d76f94e1343	🔥 50% discount on courses for a limited time	t	t	2	ecfbd4c3-2eee-4237-883f-419f5d1558e3	2026-03-17 10:29:58.711615+00	2026-03-17 10:29:58.711615+00	🔥 50% discount on courses for a limited time	🔥 خصم 50% على الكورسات لفترة محدودة
7d0c51da-75a3-4b05-a9b5-ecd402817240	🚀 Start your journey now with the best instructors	t	t	3	ecfbd4c3-2eee-4237-883f-419f5d1558e3	2026-03-17 10:30:30.829315+00	2026-03-17 10:30:30.829315+00	🚀 Start your journey now with the best instructors	🚀 ابدأ رحلتك الآن مع أفضل المدربين
8fc51817-246a-40d1-bccf-1dbbc54ff917	📢 Register your account and start learning	t	t	4	ecfbd4c3-2eee-4237-883f-419f5d1558e3	2026-03-17 10:31:04.252652+00	2026-03-17 10:31:04.252652+00	📢 Register your account and start learning	📢 سجّل حسابك وابدأ التعلم فورًا
a59bd890-fe4c-4348-8238-b4c6cabc7a35	💡 Develop your skills and start today	t	t	5	ecfbd4c3-2eee-4237-883f-419f5d1558e3	2026-03-17 10:32:22.607766+00	2026-03-17 10:32:22.607766+00	💡 Develop your skills and start today	💡 طوّر مهاراتك وابدأ من اليوم
\.


--
-- Data for Name: ads_display_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ads_display_settings (id, hero_title, hero_subtitle, search_placeholder, stat_ads_label, stat_users_label, stat_satisfaction_label, stat_support_label, stat_support_value, homepage_promo_enabled, homepage_promo_type, homepage_promo_media_url, homepage_promo_link, homepage_promo_title, homepage_promo_subtitle, created_at, updated_at) FROM stdin;
2de14592-1b6f-4742-b4eb-e594ab122cfa	اكتشف أفضل الإعلانات	\N	\N	\N	\N	\N	\N	24/7	f	image	\N	\N	\N	\N	2026-03-17 09:48:10.436539+00	2026-03-17 09:49:46.254252+00
\.


--
-- Data for Name: ai_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_config (id, ai_enabled, ai_provider, ai_model, api_key, api_secret, max_tokens, temperature, custom_config, updated_by, updated_at, created_at, created_by) FROM stdin;
1	f	gemini	gemini-2.5-flash	\N	\N	4096	0.70	{}	\N	2026-02-24 10:53:16.922511+00	2026-02-24 10:53:16.922511+00	\N
\.


--
-- Data for Name: assignment_submissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.assignment_submissions (id, student_id, instructor_id, course_id, assignment_id, item_id, submission_type, prompt, rubric, answer, status, score, feedback, graded_by, graded_at, metadata, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: attendance_records; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.attendance_records (id, user_id, course_id, session_date, status, duration_seconds, items_completed, milestone_events, last_active) FROM stdin;
54d985da-bbfb-476d-9cbf-42a9dc74311f	35149d1d-04f9-46f4-92d4-de88ef4d537e	4d748a62-23d3-4abb-9a7d-10874feffee5	2026-03-29	PRESENT	191	1	2	2026-03-29 09:18:23.969843+00
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_logs (id, tenant_id, user_id, user_email, action, resource_type, resource_id, ip_address, user_agent, status, error_message, metadata, state_before, state_after, created_at) FROM stdin;
1aade37c-2eb9-47c6-8684-5d7d9a9f52b6	77ec1d51-2c26-47c7-b917-589cf643588e	\N	reham@reham.com	tenant.create	tenant	77ec1d51-2c26-47c7-b917-589cf643588e	\N	\N	success	\N	{"subdomain": "reham", "companyName": "reham", "subscriptionPlan": "basic"}	\N	{"id": "77ec1d51-2c26-47c7-b917-589cf643588e", "status": "pending_payment", "subdomain": "reham", "companyName": "reham", "subscriptionPlan": "basic"}	2026-03-04 10:46:13.432754+00
d315a924-bb84-4f11-a1c9-aece130d2c03	3d2a7d54-eef4-4e2a-bc35-531dac0f2c39	\N	xyz@xyz.com	tenant.create	tenant	3d2a7d54-eef4-4e2a-bc35-531dac0f2c39	\N	\N	success	\N	{"subdomain": "xyz", "companyName": "Xyz", "subscriptionPlan": "basic"}	\N	{"id": "3d2a7d54-eef4-4e2a-bc35-531dac0f2c39", "status": "pending_payment", "subdomain": "xyz", "companyName": "Xyz", "subscriptionPlan": "basic"}	2026-03-04 13:34:04.019003+00
487b3d1b-3234-4413-b972-573ee78d7764	6a3960fb-4bee-435d-8c87-002eeaa5cfc3	\N	123@admin.com	tenant.create	tenant	6a3960fb-4bee-435d-8c87-002eeaa5cfc3	\N	\N	success	\N	{"subdomain": "rhema", "companyName": "123", "subscriptionPlan": "basic"}	\N	{"id": "6a3960fb-4bee-435d-8c87-002eeaa5cfc3", "status": "pending_payment", "subdomain": "rhema", "companyName": "123", "subscriptionPlan": "basic"}	2026-03-04 14:03:14.383462+00
af87c271-b196-4fd9-bae5-3ec48f84c1dd	b12cea5c-4611-4484-a7e1-97440c51eb68	\N	reham@admin.com	tenant.create	tenant	b12cea5c-4611-4484-a7e1-97440c51eb68	\N	\N	success	\N	{"subdomain": "tete", "companyName": "reham", "subscriptionPlan": "basic"}	\N	{"id": "b12cea5c-4611-4484-a7e1-97440c51eb68", "status": "active", "subdomain": "tete", "companyName": "reham", "subscriptionPlan": "basic"}	2026-03-04 14:13:43.560573+00
e5a0e1b5-29e3-4454-86d1-2ecd3b2ae806	a4f738cf-78ff-4291-9a36-ed20adff3934	\N	yoyo@yoyo.com	tenant.create	tenant	a4f738cf-78ff-4291-9a36-ed20adff3934	\N	\N	success	\N	{"subdomain": "yoyo", "companyName": "yoyo", "subscriptionPlan": "basic"}	\N	{"id": "a4f738cf-78ff-4291-9a36-ed20adff3934", "status": "active", "subdomain": "yoyo", "companyName": "yoyo", "subscriptionPlan": "basic"}	2026-03-04 14:14:45.954321+00
1273a3ac-ac6f-438c-9e0c-dc897f22dcfa	4ead1eb0-8dab-419d-953e-76e0142d80a5	\N	reham@tete.com	tenant.create	tenant	4ead1eb0-8dab-419d-953e-76e0142d80a5	\N	\N	success	\N	{"subdomain": "tetette", "companyName": "reham", "subscriptionPlan": "basic"}	\N	{"id": "4ead1eb0-8dab-419d-953e-76e0142d80a5", "status": "active", "subdomain": "tetette", "companyName": "reham", "subscriptionPlan": "basic"}	2026-03-04 14:21:33.212074+00
e0657be4-eaac-46ab-b41c-260180b1882d	a19d448c-0018-466f-8f35-0b8eaf01e2f9	\N	lara@lara.com	tenant.create	tenant	a19d448c-0018-466f-8f35-0b8eaf01e2f9	\N	\N	success	\N	{"subdomain": "lara", "companyName": "lara", "subscriptionPlan": "basic"}	\N	{"id": "a19d448c-0018-466f-8f35-0b8eaf01e2f9", "status": "active", "subdomain": "lara", "companyName": "lara", "subscriptionPlan": "basic"}	2026-03-04 14:48:10.595912+00
b8c2db7a-09ca-4604-9173-570e57c60449	74bf2ead-ebc3-4061-a988-778c2a16ff9e	\N	adnan@poshasaudi.com	tenant.create	tenant	74bf2ead-ebc3-4061-a988-778c2a16ff9e	\N	\N	success	\N	{"subdomain": "poshacademy", "companyName": "Posha Academy", "subscriptionPlan": "basic"}	\N	{"id": "74bf2ead-ebc3-4061-a988-778c2a16ff9e", "status": "active", "subdomain": "poshacademy", "companyName": "Posha Academy", "subscriptionPlan": "basic"}	2026-03-04 15:00:39.340861+00
a2aaef1d-8a22-4beb-9061-20d9cff618fe	60a51aeb-86f2-442b-81e0-d2d07821af46	\N	Test@admin.com	tenant.create	tenant	60a51aeb-86f2-442b-81e0-d2d07821af46	\N	\N	success	\N	{"subdomain": "test", "companyName": "Tesr", "subscriptionPlan": "basic"}	\N	{"id": "60a51aeb-86f2-442b-81e0-d2d07821af46", "status": "active", "subdomain": "test", "companyName": "Tesr", "subscriptionPlan": "basic"}	2026-03-04 15:12:44.951586+00
61e7c319-4e0c-4a02-8465-d2a0efe52111	22ab2fce-c868-4648-8fdf-8eb629f9a494	\N	admin@reham.com	tenant.create	tenant	22ab2fce-c868-4648-8fdf-8eb629f9a494	\N	\N	success	\N	{"subdomain": "reham1", "companyName": "reham1", "subscriptionPlan": "basic"}	\N	{"id": "22ab2fce-c868-4648-8fdf-8eb629f9a494", "status": "active", "subdomain": "reham1", "companyName": "reham1", "subscriptionPlan": "basic"}	2026-03-05 09:10:32.176233+00
f6142017-c07a-488e-820c-fb6df502c305	7b05964c-da31-4212-9471-b9384d575715	\N	admin@sasha.com	tenant.create	tenant	7b05964c-da31-4212-9471-b9384d575715	\N	\N	success	\N	{"subdomain": "sasha", "companyName": "sasha", "subscriptionPlan": "basic"}	\N	{"id": "7b05964c-da31-4212-9471-b9384d575715", "status": "active", "subdomain": "sasha", "companyName": "sasha", "subscriptionPlan": "basic"}	2026-03-08 13:07:12.215823+00
6de7b8cb-9fa8-43ac-a470-f9ddfec343b7	ac199157-3bc3-4792-9f84-4b6b80026d19	\N	naiosh2021@gmail.com	tenant.create	tenant	ac199157-3bc3-4792-9f84-4b6b80026d19	\N	\N	success	\N	{"subdomain": "upacs", "companyName": "upacs", "subscriptionPlan": "basic"}	\N	{"id": "ac199157-3bc3-4792-9f84-4b6b80026d19", "status": "active", "subdomain": "upacs", "companyName": "upacs", "subscriptionPlan": "basic"}	2026-03-10 12:07:03.63885+00
cf578879-85ed-4bd1-9b0f-ac63bbfed1d6	6307963b-7063-4202-80c3-0200b33218c6	\N	Abc@abc.com	tenant.create	tenant	6307963b-7063-4202-80c3-0200b33218c6	\N	\N	success	\N	{"subdomain": "abc", "companyName": "abc", "subscriptionPlan": "basic"}	\N	{"id": "6307963b-7063-4202-80c3-0200b33218c6", "status": "active", "subdomain": "abc", "companyName": "abc", "subscriptionPlan": "basic"}	2026-03-10 12:20:41.161188+00
37a9c7da-d418-4e82-8bf9-8f38da7cc6b3	1da3fada-f597-4a2a-86c1-41cbb19dd456	\N	abona@kolna.com	tenant.create	tenant	1da3fada-f597-4a2a-86c1-41cbb19dd456	\N	\N	success	\N	{"subdomain": "abona", "companyName": "abona", "subscriptionPlan": "basic"}	\N	{"id": "1da3fada-f597-4a2a-86c1-41cbb19dd456", "status": "active", "subdomain": "abona", "companyName": "abona", "subscriptionPlan": "basic"}	2026-03-10 12:25:57.90134+00
892a1764-8167-4d02-b183-62d635da4302	fd0698bf-7c64-4cc6-939f-216e24111483	\N	infosoqia@gmail.com	tenant.create	tenant	fd0698bf-7c64-4cc6-939f-216e24111483	\N	\N	success	\N	{"subdomain": "wego-academy", "companyName": "معا نمضي", "subscriptionPlan": "basic"}	\N	{"id": "fd0698bf-7c64-4cc6-939f-216e24111483", "status": "active", "subdomain": "wego-academy", "companyName": "معا نمضي", "subscriptionPlan": "basic"}	2026-04-25 18:04:07.447088+00
c6af24f3-9907-4119-8013-99f011201caa	67cc3fea-70d6-4c48-87c4-93fee941cc53	\N	infosoqia@gmail.com	tenant.create	tenant	67cc3fea-70d6-4c48-87c4-93fee941cc53	\N	\N	success	\N	{"subdomain": "beauty", "companyName": "اكاديمية الجمال", "subscriptionPlan": "basic"}	\N	{"id": "67cc3fea-70d6-4c48-87c4-93fee941cc53", "status": "active", "subdomain": "beauty", "companyName": "اكاديمية الجمال", "subscriptionPlan": "basic"}	2026-04-26 07:29:44.928173+00
8f2a5352-a36f-4200-aa9b-e6b4af114a64	b524ae48-9a4e-467f-bdcf-1a6ee78d5c3c	\N	naiosh2021@gmail.com	tenant.create	tenant	b524ae48-9a4e-467f-bdcf-1a6ee78d5c3c	\N	\N	success	\N	{"subdomain": "demo", "companyName": "demo", "subscriptionPlan": "basic"}	\N	{"id": "b524ae48-9a4e-467f-bdcf-1a6ee78d5c3c", "status": "active", "subdomain": "demo", "companyName": "demo", "subscriptionPlan": "basic"}	2026-04-27 05:30:52.933307+00
1a9591e7-578f-412b-a658-b33d3edc942f	8c46ae66-f491-4d42-9ec6-62a9800dff18	\N	infosoqia@gmail.com	tenant.create	tenant	8c46ae66-f491-4d42-9ec6-62a9800dff18	\N	\N	success	\N	{"subdomain": "wego", "companyName": "wego-academy", "subscriptionPlan": "basic"}	\N	{"id": "8c46ae66-f491-4d42-9ec6-62a9800dff18", "status": "active", "subdomain": "wego", "companyName": "wego-academy", "subscriptionPlan": "basic"}	2026-04-28 17:48:52.073811+00
1a480c48-df9d-44a9-a2ee-80c2807ed427	da3939fd-10b0-4256-9f14-ef0fe93cd020	\N	infosoqia@gmail.com	tenant.create	tenant	da3939fd-10b0-4256-9f14-ef0fe93cd020	\N	\N	success	\N	{"subdomain": "atyaf", "companyName": "اطياف", "subscriptionPlan": "basic"}	\N	{"id": "da3939fd-10b0-4256-9f14-ef0fe93cd020", "status": "active", "subdomain": "atyaf", "companyName": "اطياف", "subscriptionPlan": "basic"}	2026-05-03 15:16:29.274469+00
\.


--
-- Data for Name: blog_posts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.blog_posts (id, title, excerpt, content, author, image, published_on, is_featured, status, category, video_url, uploaded_image_path, uploaded_video_path, slug) FROM stdin;
b540663c-6265-4e94-9150-b4e5bbbdfe37	التكنولوجيا في حياتنا اليومية	ملخص قصير	<div><b>📱 التكنولوجيا في حياتنا اليومية</b></div><div><b><br></b></div><div><b>في العصر الحالي، بقت التكنولوجيا جزء أساسي من حياتنا، ومفيش حد يقدر يستغنى عنها. من أول الموبايل اللي في إيدينا، لحد الإنترنت والتطبيقات اللي بنستخدمها كل يوم، كلها أمثلة على التطور التكنولوجي اللي غير شكل حياتنا بالكامل.</b></div><div><b><br></b></div><div><b>💡 إيه هي التكنولوجيا؟</b></div><div><b><br></b></div><div><b>ببساطة، التكنولوجيا هي استخدام العلم علشان نحل مشاكل ونسهّل حياتنا. يعني أي جهاز أو برنامج بيساعدك تعمل حاجة بشكل أسرع وأسهل يعتبر تكنولوجيا.</b></div><div><b><br></b></div><div><b>🚀 أهمية التكنولوجيا</b></div><div><b><br></b></div><div><b>التكنولوجيا ليها دور كبير في كل حاجة حوالينا، زي:</b></div><div><b><br></b></div><div><b>التعليم: بقى ممكن نتعلم أونلاين من البيت بسهولة.</b></div><div><b><br></b></div><div><b>الشغل: شركات كتير بقت تعتمد على الإنترنت والبرامج.</b></div><div><b><br></b></div><div><b>التواصل: بقى سهل نتكلم مع أي حد في أي مكان في العالم.</b></div><div><b><br></b></div><div><b>الصحة: أجهزة حديثة بتساعد في تشخيص وعلاج الأمراض بشكل أدق.</b></div><div><b><br></b></div><div><b>📊 مميزات التكنولوجيا</b></div><div><b><br></b></div><div><b>بتوفر الوقت والمجهود</b></div><div><b><br></b></div><div><b>بتزود الإنتاجية</b></div><div><b><br></b></div><div><b>بتسهّل الوصول للمعلومات</b></div><div><b><br></b></div><div><b>بتخلي العالم كله قريب من بعض</b></div><div><b><br></b></div><div><b>⚠️ عيوب التكنولوجيا</b></div><div><b><br></b></div><div><b>رغم مميزاتها، ليها شوية عيوب لازم ناخد بالنا منها:</b></div><div><b><br></b></div><div><b>الإدمان على الموبايل والإنترنت</b></div><div><b><br></b></div><div><b>قلة التفاعل الاجتماعي الحقيقي</b></div><div><b><br></b></div><div><b>مشاكل صحية زي ضعف النظر</b></div><div><b><br></b></div><div><b>فقدان بعض الوظائف بسبب الأتمتة</b></div><div><b><br></b></div><div><b>🔮 مستقبل التكنولوجيا</b></div><div><b><br></b></div><div><b>المستقبل هيكون فيه تطور أكبر، زي:</b></div><div><b><br></b></div><div><b>الذكاء الاصطناعي</b></div><div><b><br></b></div><div><b>الروبوتات</b></div><div><b><br></b></div><div><b>السيارات ذاتية القيادة</b></div><div><b><br></b></div><div><b>الواقع الافتراضي</b></div><div><b><br></b></div><div><b>وده هيخلي الحياة أسهل، بس محتاجين نستخدم التكنولوجيا بشكل ذكي ومتوازن.</b></div><div><b><br></b></div><div><b>✅ الخلاصة</b></div><div><b><br></b></div><div><b>التكنولوجيا سلاح ذو حدين، ممكن تفيدنا جدًا لو استخدمناها صح، وممكن تضرنا لو اعتمدنا عليها زيادة عن اللزوم. المهم هو التوازن.</b></div>	admin	https://mediaaws-live.almasryalyoum.com/almasryalyoum/uploads/images/2025/11/28/thumbs/600x600/1468625.jpg	2026-03-08	t	PUBLISHED	Languages				-2
\.


--
-- Data for Name: career_applications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.career_applications (id, job_id, job_title, applicant_name, applicant_email, applicant_phone, resume_url, cover_letter, job_snapshot, status, created_at, resume_file_path) FROM stdin;
\.


--
-- Data for Name: central_live_platform_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.central_live_platform_config (id, smrrtx_enabled, smrrtx_permanent_room_link, zoom_enabled, zoom_config_link, zoom_client_id, zoom_client_secret, zoom_account_id, zoom_user_id, meet_enabled, meet_config_link, google_sa_email, google_sa_key, google_calendar_id, updated_at) FROM stdin;
1	t	\N	f	\N	\N	\N	\N	\N	f	\N	\N	\N	\N	2026-03-11 10:29:34.97448+00
\.


--
-- Data for Name: central_schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.central_schema_migrations (filename, applied_at) FROM stdin;
000_enable_extensions.sql	2026-02-24 10:53:15.960761+00
001_create_tenants.sql	2026-02-24 10:53:16.004925+00
002_create_tenant_admins.sql	2026-02-24 10:53:16.043204+00
003_create_provisioning_logs.sql	2026-02-24 10:53:16.086891+00
004_create_subscriptions.sql	2026-02-24 10:53:16.122731+00
005_create_payment_transactions.sql	2026-02-24 10:53:16.156713+00
006_create_platform_users.sql	2026-02-24 10:53:16.192789+00
006_create_tenant_user_links.sql	2026-02-24 10:53:16.240167+00
007_create_media_settings.sql	2026-02-24 10:53:16.278295+00
008_fix_media_settings_persistence.sql	2026-02-24 10:53:16.314552+00
009_standardize_audit_columns.sql	2026-02-24 10:53:16.349699+00
010_create_audit_logs.sql	2026-02-24 10:53:16.387686+00
011_create_system_settings.sql	2026-02-24 10:53:16.430509+00
012_create_payment_gateway_config.sql	2026-02-24 10:53:16.467106+00
013_add_stripe_price_ids.sql	2026-02-24 10:53:16.503754+00
013_create_subscription_plans.sql	2026-02-24 10:53:16.536424+00
014_add_plan_amounts.sql	2026-02-24 10:53:16.575058+00
014_create_subscription_plan_prices.sql	2026-02-24 10:53:16.619341+00
015_update_subscriptions_locked_pricing.sql	2026-02-24 10:53:16.66352+00
016_backfill_subscriptions_data.sql	2026-02-24 10:53:16.707074+00
017_add_password_hash.sql	2026-02-24 10:53:16.744709+00
018_enforce_subscription_pricing_model.sql	2026-02-24 10:53:16.781047+00
019_set_default_plan_pricing.sql	2026-02-24 10:53:16.819208+00
020_change_plan_amounts_to_numeric.sql	2026-02-24 10:53:16.852825+00
021_fix_secret_key_column_types.sql	2026-02-24 10:53:16.888036+00
022_create_ai_config.sql	2026-02-24 10:53:16.922511+00
023_create_subscription_refunds.sql	2026-02-24 10:53:16.957386+00
024_create_central_seo_settings.sql	2026-02-24 10:53:17.01301+00
025_add_pending_payment_status.sql	2026-02-24 10:53:17.047491+00
026_fix_updated_at_trigger_and_columns.sql	2026-02-24 10:53:17.082496+00
027_add_central_course_payment_support.sql	2026-02-24 10:53:17.123253+00
028_add_password_reset_tokens.sql	2026-03-05 12:20:10.63775+00
029_create_email_settings.sql	2026-03-09 08:59:55.645235+00
030_create_freelancer_and_membership_submissions.sql	2026-03-26 10:17:46.801725+00
031_add_national_id_to_users.sql	2026-04-27 09:09:22.122688+00
032_add_public_user_id_to_users.sql	2026-04-27 11:28:41.1088+00
033_add_phone_country_code_to_users.sql	2026-04-28 08:43:25.711093+00
034_add_gender_and_specialization_to_users.sql	2026-04-28 10:32:53.638185+00
035_add_follow_up_status_to_users.sql	2026-04-28 10:52:33.911957+00
\.


--
-- Data for Name: central_seo_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.central_seo_settings (id, page_path, title_en, title_ar, description_en, description_ar, keywords_en, keywords_ar, canonical_url, robots, indexable, og_title_en, og_title_ar, og_description_en, og_description_ar, og_image_url, og_type, og_site_name, twitter_card, twitter_title_en, twitter_title_ar, twitter_description_en, twitter_description_ar, twitter_image_url, jsonld_en, jsonld_ar, locale, locale_alternate, sitemap_priority, sitemap_changefreq, created_at, updated_at, created_by, updated_by) FROM stdin;
\.


--
-- Data for Name: certificates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.certificates (id, user_id, course_id, issue_date, certification_number, type, course_level, url) FROM stdin;
9b69e294-f4fe-4f0a-9a63-dbe25a40a51c	35149d1d-04f9-46f4-92d4-de88ef4d537e	4d748a62-23d3-4abb-9a7d-10874feffee5	2026-03-29	CERT-1774775701987-I5GU5L5EW	COMPLETION	Beginner	\N
\.


--
-- Data for Name: conversation_participants; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.conversation_participants (id, conversation_id, user_id, joined_at, left_at) FROM stdin;
\.


--
-- Data for Name: course_categories; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.course_categories (id, name, created_at, updated_at) FROM stdin;
b2500237-0a38-468f-bc6f-040ee464c6e7	Technology	2026-02-24 10:53:17.870278	2026-02-24 10:53:17.870278
8addd79a-c6ee-4df3-82cc-895bddcaa94b	Business	2026-02-24 10:53:17.870278	2026-02-24 10:53:17.870278
562714c1-028c-4db0-bf29-dca5454f0294	Finance	2026-02-24 10:53:17.870278	2026-02-24 10:53:17.870278
1ff68009-512e-422b-a8a3-68de1527559b	Marketing	2026-02-24 10:53:17.870278	2026-02-24 10:53:17.870278
97e64a0a-6865-4202-aabf-bfe7f978dbd2	Design	2026-02-24 10:53:17.870278	2026-02-24 10:53:17.870278
69655996-8bc0-43ab-8f67-0d5d3714e2ed	Languages	2026-02-24 10:53:17.870278	2026-02-24 10:53:17.870278
1ef38a48-6200-424d-bda2-6ac057db60c1	Personal Development	2026-02-24 10:53:17.870278	2026-02-24 10:53:17.870278
93b074b8-609a-41d3-8954-634fe45e4987	Health & Fitness	2026-02-24 10:53:17.870278	2026-02-24 10:53:17.870278
18b5e8e8-5f4a-485f-a1d7-ffda440afc36	Academics	2026-02-24 10:53:17.870278	2026-02-24 10:53:17.870278
f86811de-adc1-4f3a-9a0d-f62e7ffa32a5	Professional Skills	2026-02-24 10:53:17.870278	2026-02-24 10:53:17.870278
\.


--
-- Data for Name: course_payments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.course_payments (id, receipt_id, student_id, student_name, student_email, course_id, course_title, instructor_name, instructor_id, course_price, amount, payment_method, collected_by, collected_by_id, notes, stripe_session_id, stripe_payment_intent_id, receipt_url, received_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: course_progress; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.course_progress (id, user_id, course_id, completed_items, total_items, completed_count, progress_percent, last_activity, pre_test_completed, post_test_completed, pre_test_score, post_test_score) FROM stdin;
aa3bf50e-7e3a-4d16-8958-be77c7eac4db	35149d1d-04f9-46f4-92d4-de88ef4d537e	4d748a62-23d3-4abb-9a7d-10874feffee5	["i_1774775672640"]	1	1	100.00	2026-03-29 09:17:09.65729+00	f	f	0.00	0.00
\.


--
-- Data for Name: courses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.courses (id, title, description, instructor, level, price, thumbnail, modules, sync_sessions, duration, pre_course_test, post_course_test, created_at, category, created_by, language, status, target_audience, prerequisites, learning_outcomes) FROM stdin;
4d748a62-23d3-4abb-9a7d-10874feffee5	اللغة العربية	الوصف	testtt	Beginner	0.00	/uploads/course-images/thumbnail-1774775648396-f90e902b-750d-4b2d-9ab2-df376a90f965.jpeg	[{"id": "m_1774775671168", "items": [{"id": "i_1774775672640", "type": "TEXT", "title": "محتوى جديد", "content": "123"}], "title": "وحدة جديدة"}]	{}	\N	{"enabled": false, "questions": [], "aiGradingRubric": ""}	{"enabled": false, "questions": [], "aiGradingRubric": ""}	2026-03-29 09:14:38.200919+00	Technology	\N	en	published	\N	\N	\N
909c5df3-5fa7-46d3-93a4-5ecb36cd09d0	السلامة والصحة المهنية حسب معايير بوشا	تعتبر دورة السلامة والصحة المهنية حسب معايير اوشا .. من الدورات الضرورية التي يجب على كل من يعمل بالسلامة ان يحضر هذه الدورة التي تعطي شرحا كاملا على كفية الإستفادة من المعايير الدولية للسلامة	ابو حميد عدنان	Intermediate	0.00	/uploads/course-images/thumbnail-1775980867246-1657dbfd-b7ba-4165-a742-9a1b311a6506.jpg	[{"id": "m_1775980962024", "items": [{"id": "i_1775981021520", "type": "TEXT", "title": "محتوى جديد", "content": ""}], "title": "تكوين فكرة مهمة على كيفية التعامل مع المخاطر التي تظهر اثناء تنفيذ العمل"}]	{}	\N	{"enabled": false, "questions": [], "aiGradingRubric": ""}	{"enabled": false, "questions": [], "aiGradingRubric": ""}	2026-04-12 08:05:09.12388+00	Technology	\N	en	published	المدراء والمهندسين والمشرفين العاملين في السلامة المهنية	مبادئ السلامة والصحة المهنية	يكون المتدرب قادرا على فهم المعايير الخاصة بالسلامة المهنية
\.


--
-- Data for Name: credit_redemption_options; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.credit_redemption_options (id, title, type, description, required_credits, metadata, is_active, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: credit_redemptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.credit_redemptions (id, user_id, option_id, credits_spent, status, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: credit_transactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.credit_transactions (id, user_id, actor_id, amount, action_type, source, reason, metadata, created_at) FROM stdin;
a101dbda-ae18-4249-a963-931f7e13b680	871ac3b1-0b01-408e-98da-0e86ae31cda3	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	100	EARN	ADMIN	\N	{"scope": "INSTRUCTOR_PANEL"}	2026-03-08 11:56:35.89068+00
7bfb4126-11c8-4942-afcd-19a93b975be8	871ac3b1-0b01-408e-98da-0e86ae31cda3	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	100	DEDUCT	ADMIN	\N	{"scope": "INSTRUCTOR_PANEL"}	2026-03-08 11:56:40.911509+00
c590b6f2-be10-4a16-96f5-900d6119d59a	35149d1d-04f9-46f4-92d4-de88ef4d537e	\N	65	EARN	COURSE_PLAYER	مكافأة إتمام الدرس	{"itemId": "i_1772970595499", "courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531", "moduleId": "m_1772970583292", "rewardKey": "LESSON_COMPLETION|91c5a9fe-797d-48ce-99e1-0fd00bf15531|m_1772970583292|i_1772970595499", "rewardType": "LESSON_COMPLETION"}	2026-03-29 09:12:11.869262+00
fa13ae37-8f92-421e-b713-7f0f9b9c603d	35149d1d-04f9-46f4-92d4-de88ef4d537e	\N	65	EARN	COURSE_PLAYER	مكافأة إتمام الدرس	{"itemId": "i_1774775672640", "courseId": "4d748a62-23d3-4abb-9a7d-10874feffee5", "moduleId": "m_1774775671168", "rewardKey": "LESSON_COMPLETION|4d748a62-23d3-4abb-9a7d-10874feffee5|m_1774775671168|i_1774775672640", "rewardType": "LESSON_COMPLETION"}	2026-03-29 09:15:00.557693+00
fb495978-cda8-4ca2-b4ee-840220046d77	35149d1d-04f9-46f4-92d4-de88ef4d537e	\N	65	EARN	COURSE_PLAYER	مكافأة إكمال الدورة	{"courseId": "4d748a62-23d3-4abb-9a7d-10874feffee5", "rewardKey": "COURSE_COMPLETION|4d748a62-23d3-4abb-9a7d-10874feffee5", "rewardType": "COURSE_COMPLETION"}	2026-03-29 09:15:01.98608+00
\.


--
-- Data for Name: discounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.discounts (id, code, percentage, course_id, created_by, expiry_date, usage_count) FROM stdin;
\.


--
-- Data for Name: email_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.email_settings (id, scope, tenant_id, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_secure, created_by, updated_by, created_at, updated_at) FROM stdin;
f4b3dfb8-ec14-4099-bc0f-fdce2fcad630	tenant	7b05964c-da31-4212-9471-b9384d575715	smtp.gmail.com	587	rehamkmw1@gmail.com	lhgq rxhp yjuu slee	rehamkmw1@gmail.com	f	9baa5aa2-7b2e-4166-85ba-37433561fc90	9baa5aa2-7b2e-4166-85ba-37433561fc90	2026-03-09 09:30:47.789585+00	2026-03-09 09:30:47.789585+00
\.


--
-- Data for Name: enrollments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.enrollments (id, user_id, course_id, enrolled_at) FROM stdin;
5c30d6c1-9b7f-4de2-b0db-5649f1ff7621	35149d1d-04f9-46f4-92d4-de88ef4d537e	4d748a62-23d3-4abb-9a7d-10874feffee5	2026-03-29 09:14:53.765228+00
\.


--
-- Data for Name: freelancer_submissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.freelancer_submissions (id, full_name, email, phone, country, field_of_expertise, years_of_experience, short_bio, cv_url, status, notes, created_at, updated_at) FROM stdin;
69e2d82b-3a4f-475c-8ad6-f15e11f6ed5a	test	reham@freelancer.com	123	saudi	ai	5	123	/uploads/resumes/resume-1774522193420-9ff4b5a4-b512-4c32-9844-8e1a17bdd829.pdf	NEW	\N	2026-03-26 10:49:54.574211+00	2026-03-26 10:49:54.574211+00
\.


--
-- Data for Name: instructor_assignments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.instructor_assignments (id, instructor_id, course_id, title, question, rubric, difficulty, topic, due_date, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: instructor_payouts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.instructor_payouts (id, instructor_id, instructor_name, amount, payment_method, course_id, course_title, reference, notes, recorded_by, recorded_by_name, recorded_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: live_class_invites; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.live_class_invites (id, live_class_id, student_id, email, invite_token, status, created_at) FROM stdin;
63369205-df46-4ae0-bd67-2d01053df181	0dcb01d2-d897-4f1c-a9ec-3cb964f761b5	d4acfbd7-c67f-417e-8cfa-410b44d14e40	ahmed.hassan@example.com	\N	INVITED	2026-03-09 11:14:06.231364+00
8259e822-d577-48f8-8979-9ed80a354b79	b8699975-e321-4aa3-8aff-439dc38bbbe8	d4acfbd7-c67f-417e-8cfa-410b44d14e40	ahmed.hassan@example.com	\N	INVITED	2026-03-09 11:44:13.194516+00
2d5b9b53-ba60-40a0-bcb4-f4986226ed8b	9efd9a73-8a60-4c45-a19d-f53f75bac5e6	d4acfbd7-c67f-417e-8cfa-410b44d14e40	rehamkmw1@gmail.com	\N	INVITED	2026-03-09 12:00:17.947047+00
04dacdd1-3bcb-43f2-9942-7fecae18eda0	1e40253c-be9c-4b6f-9faf-0ca335c3b66a	d4acfbd7-c67f-417e-8cfa-410b44d14e40	rehamkmw1@gmail.com	\N	INVITED	2026-03-09 12:04:15.920692+00
7ef81bcd-959a-4101-9e14-cd0ea01fe38d	e0748fbf-60c5-483d-abb0-905651a5fee9	d4acfbd7-c67f-417e-8cfa-410b44d14e40	rehamkmw1@gmail.com	\N	INVITED	2026-03-09 12:07:45.929119+00
e44d3494-f854-4579-aecf-109e03e66cc3	93d6088f-d845-472e-a0a2-7c3f0be87bbb	871ac3b1-0b01-408e-98da-0e86ae31cda3	john.doe@example.com	\N	INVITED	2026-03-09 12:13:54.761737+00
7f9b476a-3e7d-4d12-ba81-a4d3cb729901	98b452c7-618c-47c8-8b9c-1b98bca5515d	d4acfbd7-c67f-417e-8cfa-410b44d14e40	rehamkmw1@gmail.com	\N	INVITED	2026-03-11 09:14:25.53851+00
d25d3790-0ae7-43f0-b550-0631b5eabfba	37036299-2fcc-45b3-97d8-4dbb972c8499	d4acfbd7-c67f-417e-8cfa-410b44d14e40	rehamkmw1@gmail.com	\N	INVITED	2026-03-11 09:22:55.595883+00
29173a92-cc46-449c-862a-972e11658829	8747b8e7-f86b-4b8c-b7e1-36d9f4266637	35149d1d-04f9-46f4-92d4-de88ef4d537e	reham111@student.com	\N	INVITED	2026-03-11 09:32:53.101105+00
a0d51b15-abfd-47de-a470-54c78ede29b6	474427d4-ede3-412b-9511-6e7f389e2a1b	35149d1d-04f9-46f4-92d4-de88ef4d537e	reham111@student.com	\N	INVITED	2026-03-11 09:41:35.758253+00
461c0d75-5e9f-4f02-92d9-55074cd0a3cd	01f122fd-dbcf-480a-b26b-2941cf0983ff	35149d1d-04f9-46f4-92d4-de88ef4d537e	reham111@student.com	\N	INVITED	2026-03-11 09:44:33.804784+00
\.


--
-- Data for Name: live_classes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.live_classes (id, instructor_id, topic, agenda, start_time, platform, provider_meeting_id, host_url, join_url, passcode, invite_type, duration_minutes, status, recording_url, created_at) FROM stdin;
0dcb01d2-d897-4f1c-a9ec-3cb964f761b5	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	test	test	2026-03-09 11:13:00+00	meet	betacademy-test-8e76f963	https://meet.jit.si/betacademy-test-8e76f963	https://meet.jit.si/betacademy-test-8e76f963	\N	specific	60	COMPLETED	\N	2026-03-09 11:14:06.231364+00
b8699975-e321-4aa3-8aff-439dc38bbbe8	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	testttttt	\N	2026-03-09 11:44:00+00	meet	betacademy-testttttt-5616172b	https://meet.google.com/yhc-ksrk-edi	https://meet.google.com/yhc-ksrk-edi	\N	specific	60	CANCELLED	\N	2026-03-09 11:44:13.194516+00
9efd9a73-8a60-4c45-a19d-f53f75bac5e6	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	1111111111	aaaa	2026-03-09 12:00:00+00	meet	betacademy-1111111111-31122b58	https://meet.new	https://meet.new	\N	specific	60	COMPLETED	\N	2026-03-09 12:00:17.947047+00
1e40253c-be9c-4b6f-9faf-0ca335c3b66a	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	aaaaaaaa	aa	2026-03-09 12:04:00+00	meet	betacademy-aaaaaaaa-b6522f45	https://meet.new	https://meet.new	\N	specific	60	COMPLETED	\N	2026-03-09 12:04:15.920692+00
8747b8e7-f86b-4b8c-b7e1-36d9f4266637	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	bb	\N	2026-03-11 09:32:00+00	meet	betacademy-bb-ad400883	https://meet.new	https://meet.new	\N	specific	60	COMPLETED	\N	2026-03-11 09:32:53.101105+00
37036299-2fcc-45b3-97d8-4dbb972c8499	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	aa	\N	2026-03-11 09:22:00+00	meet	betacademy-aa-39a4a34c	https://meet.new	https://meet.new	\N	specific	60	COMPLETED	\N	2026-03-11 09:22:55.595883+00
98b452c7-618c-47c8-8b9c-1b98bca5515d	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	222	\N	2026-03-11 09:13:00+00	zoom	betacademy-222-092e5428	https://zoom.us/start/videomeeting	https://zoom.us/start/videomeeting	\N	specific	60	COMPLETED	\N	2026-03-11 09:14:25.53851+00
93d6088f-d845-472e-a0a2-7c3f0be87bbb	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	aaaaaa	\N	2026-03-09 12:13:00+00	zoom	betacademy-aaaaaa-bd63758c	https://zoom.us/start/videomeeting	https://zoom.us/start/videomeeting	\N	specific	60	COMPLETED	\N	2026-03-09 12:13:54.761737+00
e0748fbf-60c5-483d-abb0-905651a5fee9	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	bbbbbbbbb	\N	2026-03-09 12:07:00+00	zoom	betacademy-bbbbbbbbb-8ec50518	https://zoom.us/start/videomeeting	https://zoom.us/start/videomeeting	\N	specific	60	COMPLETED	\N	2026-03-09 12:07:45.929119+00
474427d4-ede3-412b-9511-6e7f389e2a1b	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	33	\N	2026-03-11 09:41:00+00	meet	betacademy-33-2183361a	https://meet.new	https://meet.new	\N	specific	60	COMPLETED	\N	2026-03-11 09:41:35.758253+00
01f122fd-dbcf-480a-b26b-2941cf0983ff	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	44	\N	2026-03-11 09:44:00+00	meet	betacademy-44-9e7f39c9	https://meet.new	https://meet.new	\N	specific	60	LIVE	\N	2026-03-11 09:44:33.804784+00
\.


--
-- Data for Name: live_platform_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.live_platform_config (id, smrrtx_enabled, smrrtx_permanent_room_link, zoom_enabled, zoom_config_link, meet_enabled, meet_config_link, updated_at, zoom_client_id, zoom_client_secret, zoom_account_id, zoom_user_id, google_sa_email, google_sa_key, google_calendar_id) FROM stdin;
1	f	\N	t	\N	t	\N	2026-03-11 09:22:23.889286+00	\N	\N	\N	\N	meet-integration@beta-489710.iam.gserviceaccount.com	-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDAVnT+TI2W13gs\\n2fKjiHTtjeotWNPbAZhD3pUoI8gsgF0PwYwPz1eRv60/wtv/X34fJmyW5sYOJH4U\\n7Xa3n31euOeW0a5ke713wtqpv6Esz/RC93pSmEg0dJLj2WZNpyd4fG2OBZ3AoQgA\\nxPXHh1/p8IUM90Q7PtT+4kjLgEADogU00jXKszrtQJes7ZJ9oEhLUy8Q3mTqpCJU\\nY9PM5sLbqZOZpq9IsoRqbT18DEFtjBUJvFnYHi253Y2XsxC4gVM5YMCzYTiEfaX6\\nFU+50yhXpKP2GVggJRYEKIzJRMAhqGeQQKMdGdmFhN14PViGIP04xNi4tEy/Hhut\\ntV88JDBTAgMBAAECggEABl4DJQZF8/GTzGRPnuvVbpUCoIKuyqGw6tYAORVjw32l\\nksVj8uor6maE72CZZabBiVeW/2zOSPQJt0nXuBqpc1UkT2mg4AaCH1+asKuSzIfh\\nL9a/TbATv9maXUVch3qz5bS0zgXYkus7Zmz8puUYa8uNem8sLxz64UN+qrMLTZnT\\nxVJYuB+MafwM7xC8/WHoPGmyXpYtFt6KuThcWNIGvJ8I4RF/bOG3MnrlWKRYJuRK\\nEr579RPiYj//CZd70cyogiXb/dJQ1XqDG/3Rw+/AfUzZmauiEaNGeDcfsR822N4n\\n5HHZyl177aL+1Bpv2qgncMCE4iuXdvs40iIHsC/zhQKBgQD+cEcinU3MxxzErfNc\\nA1JUAZsmhM9vn3SsEFKTrCy39p/5Yz2AOcqa48jadL8rfFaMT+37VGen44Nv0W4S\\nV86vAZ27POsQ4gA9uEBQzFh1e9/z/U/GV4F0zEMJqxukY/q/HoFegYfHof35KGHT\\nlBfVFz2ukt5vyTnak3KTSWa63QKBgQDBhJ5v6PJYLp7DEI7ilIkNYyOizRqskEKt\\nLoXvxVqVwSiHcWZWQUUEdQGp1luGc3S8oNXZl7le/S/T+zQzloe5tkbijtCmsYJe\\nUkwC9uGrrp5Qp//f2W7CRCQv07RV3CcEfizFnFo0GeiPqGvjbvH9lLdostz1WnwV\\nVNgFCVjs7wKBgQCVdJ5UVtI8Vzkuzn8ErW7OqaLZHWo7xw5hg7T9yUT7SoLtmr2l\\ndEzubp6ss6cXhBHSmaDQ4OOCWsH6DKr7W1iss+ZS9ZWedSJvHquoyl+rovgJ+eHC\\nP+RrFxDJvRifl5rSaLjVKoD3YtAsauwLvBHDucMhqGPAhhLVsYa7vYH6gQKBgHDZ\\nr7M/OyQle7vxSgHj8NB3we5MgYOkVN29Ran/gsXV8JabkLw4L9Fbkm7CbHlJlwfx\\nGwRbMGSubVfHJDf5TokEPO4drpum5ImwoFcSNaPynqwWbGbT2306U4f4gy+WxMIf\\n+mf6t7eubCpqYxAsQL5KHXLW63fBHp8p7RdyzgLNAoGAN5zCmvXhDM9VlqvcBVCF\\n1+z7VnQbmPK9POJuyk4+/JyS2REeS4GsVYbCCRkMzcM/S4uYbOp4H2wUJwoAOwR6\\nkXR2qrVnFzzmeWbe6qcaX5qG5MWZP7ugUJOeQmKSP9j12AZQ2sT6JOikBbEKmgWR\\nJpATk8PkJkUDRv9Pe6/vzKs=\\n-----END PRIVATE KEY-----\\n	rehamkmw1@gmail.com
\.


--
-- Data for Name: media_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.media_settings (id, tenant_id, allow_direct_upload, created_at, updated_at) FROM stdin;
8aa1fae7-0fb7-4f1f-9e0d-b6d65eb7e42b	\N	t	2026-02-24 10:53:16.278295+00	2026-03-11 11:56:59.866968+00
\.


--
-- Data for Name: membership_submissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.membership_submissions (id, user_id, name, email, phone, country, membership_type, status, payment_status, payment_gateway, payment_reference, notes, created_at, updated_at) FROM stdin;
18d7e889-8099-421e-a744-75363a6efdca	19098280-9f65-4845-9e4a-cde8d3ffb589	reham	reham@membership.com	123456789	saudi	BRONZE	ACTIVE	free	\N	\N	\N	2026-03-26 10:54:07.968165+00	2026-03-26 10:54:07.968165+00
50a5c72c-bf75-4b71-bc8e-59130132b619	2662ca32-bb7e-43ff-b646-ab53715ddefd	reham	reham@paid.com	123456	12	SILVER	ACTIVE	paid	stripe	6582a6b7-761d-4152-98dc-911632dcd4ba	\N	2026-03-26 10:54:59.13059+00	2026-03-26 10:54:59.344+00
\.


--
-- Data for Name: message_audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.message_audit_logs (id, action, actor_id, target_message_id, target_user_id, conversation_id, details, created_at) FROM stdin;
\.


--
-- Data for Name: message_blocks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.message_blocks (id, user_id, blocked_by, reason, expires_at, active, created_at) FROM stdin;
\.


--
-- Data for Name: message_conversations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.message_conversations (id, course_id, created_by, type, title, is_muted, muted_until, muted_reason, muted_by, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: message_participants; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.message_participants (id, conversation_id, user_id, role, can_post, joined_at) FROM stdin;
\.


--
-- Data for Name: message_receipts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.message_receipts (id, conversation_id, user_id, last_message_id, last_read_at) FROM stdin;
\.


--
-- Data for Name: messages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.messages (id, conversation_id, course_id, sender_id, target_user_id, body, created_at, deleted_at, deleted_by, metadata) FROM stdin;
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notifications (id, user_id, message, type, read, created_at, is_read, conversation_id, target_message_id, actor_id, course_id, category, metadata, read_at) FROM stdin;
b73472ee-435a-4fc1-853b-12a6b37a10b7	d4acfbd7-c67f-417e-8cfa-410b44d14e40	You have been enrolled in عنوان الدورة *	ENROLLMENT	f	2026-03-08 12:07:53.382809+00	f	\N	\N	\N	\N	SYSTEM	{}	\N
6527647a-eda2-4045-9bde-2c659760827f	d4acfbd7-c67f-417e-8cfa-410b44d14e40	teacher scheduled "test" on MEET.	INFO	f	2026-03-09 11:14:06.231364+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	LIVE_MEETING	{"joinUrl": "https://meet.jit.si/betacademy-test-8e76f963", "platform": "meet", "startTime": "2026-03-09T11:13:00.000Z", "liveClassId": "0dcb01d2-d897-4f1c-a9ec-3cb964f761b5"}	\N
f9806b02-e7ae-425b-b486-f051481770a4	d4acfbd7-c67f-417e-8cfa-410b44d14e40	teacher scheduled "testttttt" on MEET.	INFO	f	2026-03-09 11:44:13.194516+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	LIVE_MEETING	{"joinUrl": "https://meet.google.com/yhc-ksrk-edi", "platform": "meet", "startTime": "2026-03-09T11:44:00.000Z", "liveClassId": "b8699975-e321-4aa3-8aff-439dc38bbbe8"}	\N
271640f6-22db-40d9-9544-269adca9f3a7	d4acfbd7-c67f-417e-8cfa-410b44d14e40	teacher scheduled "1111111111" on MEET.	INFO	f	2026-03-09 12:00:17.947047+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	LIVE_MEETING	{"joinUrl": "https://meet.new", "platform": "meet", "startTime": "2026-03-09T12:00:00.000Z", "liveClassId": "9efd9a73-8a60-4c45-a19d-f53f75bac5e6"}	\N
11f7841e-cd36-4a9f-8446-288bad70df09	d4acfbd7-c67f-417e-8cfa-410b44d14e40	teacher scheduled "aaaaaaaa" on MEET.	INFO	f	2026-03-09 12:04:15.920692+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	LIVE_MEETING	{"joinUrl": "https://meet.new", "platform": "meet", "startTime": "2026-03-09T12:04:00.000Z", "liveClassId": "1e40253c-be9c-4b6f-9faf-0ca335c3b66a"}	\N
bdc0a3bb-464e-4050-8f16-e8a7a20e4dfe	d4acfbd7-c67f-417e-8cfa-410b44d14e40	teacher scheduled "bbbbbbbbb" on ZOOM.	INFO	f	2026-03-09 12:07:45.929119+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	LIVE_MEETING	{"joinUrl": "https://zoom.us/start/videomeeting", "platform": "zoom", "startTime": "2026-03-09T12:07:00.000Z", "liveClassId": "e0748fbf-60c5-483d-abb0-905651a5fee9"}	\N
77f05e30-9372-4139-b795-c377903642ef	871ac3b1-0b01-408e-98da-0e86ae31cda3	teacher scheduled "aaaaaa" on ZOOM.	INFO	f	2026-03-09 12:13:54.761737+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	LIVE_MEETING	{"joinUrl": "https://zoom.us/start/videomeeting", "platform": "zoom", "startTime": "2026-03-09T12:13:00.000Z", "liveClassId": "93d6088f-d845-472e-a0a2-7c3f0be87bbb"}	\N
ec27c3fa-08d8-4db4-81df-1fa28993743c	d4acfbd7-c67f-417e-8cfa-410b44d14e40	teacher scheduled "222" on ZOOM.	INFO	f	2026-03-11 09:14:25.53851+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	LIVE_MEETING	{"joinUrl": "https://zoom.us/start/videomeeting", "platform": "zoom", "startTime": "2026-03-11T09:13:00.000Z", "liveClassId": "98b452c7-618c-47c8-8b9c-1b98bca5515d"}	\N
9d7eef8f-ebee-4cda-8202-04736d9b3fa0	d4acfbd7-c67f-417e-8cfa-410b44d14e40	teacher scheduled "aa" on MEET.	INFO	f	2026-03-11 09:22:55.595883+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	LIVE_MEETING	{"joinUrl": "https://meet.new", "platform": "meet", "startTime": "2026-03-11T09:22:00.000Z", "liveClassId": "37036299-2fcc-45b3-97d8-4dbb972c8499"}	\N
fd2ccf1b-6f87-4674-a248-3038a9f2f300	35149d1d-04f9-46f4-92d4-de88ef4d537e	teacher scheduled "bb" on MEET.	INFO	f	2026-03-11 09:32:53.101105+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	LIVE_MEETING	{"joinUrl": "https://meet.new", "platform": "meet", "startTime": "2026-03-11T09:32:00.000Z", "liveClassId": "8747b8e7-f86b-4b8c-b7e1-36d9f4266637"}	\N
8731e4d8-4ade-48c0-9dcf-b9f64bf3ae80	35149d1d-04f9-46f4-92d4-de88ef4d537e	teacher scheduled "33" on MEET.	INFO	f	2026-03-11 09:41:35.758253+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	LIVE_MEETING	{"joinUrl": "https://meet.new", "platform": "meet", "startTime": "2026-03-11T09:41:00.000Z", "liveClassId": "474427d4-ede3-412b-9511-6e7f389e2a1b"}	\N
ba7c660d-3eb9-484d-ad11-4f085c292874	35149d1d-04f9-46f4-92d4-de88ef4d537e	teacher scheduled "44" on MEET.	INFO	f	2026-03-11 09:44:33.804784+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	LIVE_MEETING	{"joinUrl": "https://meet.new", "platform": "meet", "startTime": "2026-03-11T09:44:00.000Z", "liveClassId": "01f122fd-dbcf-480a-b26b-2941cf0983ff"}	\N
e7eaf4b8-194f-4d4a-8c27-e61a6204f7ce	d10a2902-a52f-4426-b2af-53716655ae5a	"عنوان الدورة *" has new updates from teacher.	INFO	f	2026-03-08 11:58:18.819543+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	\N
8e94f41f-c805-4599-8458-99bd40699b6d	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	Your course "22222" is now live.	SUCCESS	f	2026-03-09 12:53:25.227891+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	NEW_CONTENT	{"courseId": "f97933d6-66ae-4fc4-8697-93bc0eeebe17"}	\N
c8195fa7-ab94-438d-86f6-4d03f9b02742	35149d1d-04f9-46f4-92d4-de88ef4d537e	You attempted "اختبار ما قبل الدورة" with a score of 0%.	WARNING	f	2026-03-09 13:02:12.396301+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	EXAM_RESULT	{"score": 0, "itemId": "pre-course-test", "passed": false, "courseId": "f97933d6-66ae-4fc4-8697-93bc0eeebe17", "moduleTitle": "اختبار ما قبل الدورة"}	\N
8c8ca45e-bc73-400b-ba0f-39d6f6e48b4e	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	student scored 0% on "اختبار ما قبل الدورة".	WARNING	f	2026-03-09 13:02:12.411293+00	f	\N	\N	35149d1d-04f9-46f4-92d4-de88ef4d537e	\N	EXAM_RESULT	{"itemId": "pre-course-test", "passed": false, "courseId": "f97933d6-66ae-4fc4-8697-93bc0eeebe17", "studentId": "35149d1d-04f9-46f4-92d4-de88ef4d537e"}	\N
d24e6338-7db3-4c4a-8d39-2d1377f53daa	35149d1d-04f9-46f4-92d4-de88ef4d537e	You passed "اختبار ما قبل الدورة" with a score of 100%.	SUCCESS	f	2026-03-09 13:02:16.278291+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	EXAM_RESULT	{"score": 100, "itemId": "pre-course-test", "passed": true, "courseId": "f97933d6-66ae-4fc4-8697-93bc0eeebe17", "moduleTitle": "اختبار ما قبل الدورة"}	\N
774daf88-31ad-4251-ac9d-adc2e9929b1f	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	student scored 100% on "اختبار ما قبل الدورة".	INFO	f	2026-03-09 13:02:16.293581+00	f	\N	\N	35149d1d-04f9-46f4-92d4-de88ef4d537e	\N	EXAM_RESULT	{"itemId": "pre-course-test", "passed": true, "courseId": "f97933d6-66ae-4fc4-8697-93bc0eeebe17", "studentId": "35149d1d-04f9-46f4-92d4-de88ef4d537e"}	\N
6b3b48c8-2904-4f74-9bc7-8ecd3e71b61b	35149d1d-04f9-46f4-92d4-de88ef4d537e	"اللغة العربية" has new updates from teacher.	INFO	f	2026-03-17 13:28:38.425919+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "f97933d6-66ae-4fc4-8697-93bc0eeebe17"}	\N
6d8890b4-0a15-4882-97d9-f70bf0e568e0	d4acfbd7-c67f-417e-8cfa-410b44d14e40	"عنوان الدورة *" has new updates from teacher.	INFO	f	2026-03-08 11:58:18.828172+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	\N
40a057f5-fed7-49d3-bdc9-7ce5546e454d	871ac3b1-0b01-408e-98da-0e86ae31cda3	"عنوان الدورة *" has new updates from teacher.	INFO	f	2026-03-08 11:58:18.835675+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	\N
ada3b7b8-4330-4476-a697-aab2282d3a85	35149d1d-04f9-46f4-92d4-de88ef4d537e	You passed "اختبار ما قبل الدورة" with a score of 100%.	SUCCESS	f	2026-03-08 12:00:32.845295+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	EXAM_RESULT	{"score": 100, "itemId": "pre-course-test", "passed": true, "courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531", "moduleTitle": "اختبار ما قبل الدورة"}	\N
9e55505c-6f92-4f3a-aa63-4b5f23689e17	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	Your course "عنوان الدورة *" is now live.	SUCCESS	t	2026-03-08 11:50:30.440796+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	NEW_CONTENT	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	2026-03-09 12:03:59.442212+00
d1cc1e8a-c5b4-4da5-94d5-51069b846cf4	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	Your course "عنوان الدورة *" changes are live.	SUCCESS	t	2026-03-08 11:52:31.490559+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	2026-03-09 12:03:59.442212+00
0343550c-77b8-4e1e-8dea-a6ae2ae04160	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	Your course "عنوان الدورة *" changes are live.	SUCCESS	t	2026-03-08 11:58:18.850263+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	2026-03-09 12:03:59.442212+00
dfb76887-b5a2-408a-824e-48df0d3a6d9a	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	student scored 100% on "اختبار ما قبل الدورة".	INFO	t	2026-03-08 12:00:32.86412+00	f	\N	\N	35149d1d-04f9-46f4-92d4-de88ef4d537e	\N	EXAM_RESULT	{"itemId": "pre-course-test", "passed": true, "courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531", "studentId": "35149d1d-04f9-46f4-92d4-de88ef4d537e"}	2026-03-09 12:03:59.442212+00
91cb91b4-93cd-44b3-ba47-ccf4f65d1f51	d10a2902-a52f-4426-b2af-53716655ae5a	"اللغة الانجليزية" has new updates from teacher.	INFO	f	2026-03-17 13:28:56.51262+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	\N
9066239e-9a82-48dd-97e3-890f20161800	35149d1d-04f9-46f4-92d4-de88ef4d537e	"اللغة الانجليزية" has new updates from teacher.	INFO	f	2026-03-17 13:28:56.521092+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	\N
ff88b426-8621-49bd-987f-f60555fdf2fa	871ac3b1-0b01-408e-98da-0e86ae31cda3	"اللغة الانجليزية" has new updates from teacher.	INFO	f	2026-03-17 13:28:56.527639+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	\N
4902fcb7-76e4-4bba-9171-4a4c8d866c6e	d4acfbd7-c67f-417e-8cfa-410b44d14e40	"اللغة الانجليزية" has new updates from teacher.	INFO	f	2026-03-17 13:28:56.533931+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	\N
807a7868-1d70-447c-a9cf-c0afb922f485	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	Your course "اللغة الانجليزية" changes are live.	SUCCESS	f	2026-03-17 13:28:56.602305+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	\N
362e936f-d916-4a45-90a3-17f018c72656	d10a2902-a52f-4426-b2af-53716655ae5a	"اللغة الانجليزية" has new updates from teacher.	INFO	f	2026-03-17 13:31:11.528031+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	\N
20c47847-b41d-4c80-911f-152f5e7298d5	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	Your course "اللغة العربية" changes are live.	SUCCESS	f	2026-03-17 13:28:38.43936+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "f97933d6-66ae-4fc4-8697-93bc0eeebe17"}	\N
a47362c2-ed29-471c-a2e2-3cb4ba76ce1c	35149d1d-04f9-46f4-92d4-de88ef4d537e	"اللغة العربية" has new updates from teacher.	INFO	f	2026-03-17 13:31:54.912481+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "f97933d6-66ae-4fc4-8697-93bc0eeebe17"}	\N
9f3433ec-1dd0-4035-b935-c174aeb8c096	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	Your course "اللغة العربية" changes are live.	SUCCESS	f	2026-03-17 13:31:54.9264+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "f97933d6-66ae-4fc4-8697-93bc0eeebe17"}	\N
a214cd56-5d8a-48b2-b2b8-b3fa24b5875f	35149d1d-04f9-46f4-92d4-de88ef4d537e	You passed "اختبار ما قبل الدورة" with a score of 100%.	SUCCESS	f	2026-03-29 09:11:44.234138+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	EXAM_RESULT	{"score": 100, "itemId": "pre-course-test", "passed": true, "courseId": "f97933d6-66ae-4fc4-8697-93bc0eeebe17", "moduleTitle": "اختبار ما قبل الدورة"}	\N
86178bcf-2c7b-4709-b0f8-5fea5b4650e8	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	student scored 100% on "اختبار ما قبل الدورة".	INFO	f	2026-03-29 09:11:44.245003+00	f	\N	\N	35149d1d-04f9-46f4-92d4-de88ef4d537e	\N	EXAM_RESULT	{"itemId": "pre-course-test", "passed": true, "courseId": "f97933d6-66ae-4fc4-8697-93bc0eeebe17", "studentId": "35149d1d-04f9-46f4-92d4-de88ef4d537e"}	\N
d05be18a-03f3-49ea-86a1-0684a95be932	35149d1d-04f9-46f4-92d4-de88ef4d537e	You passed "اختبار ما قبل الدورة" with a score of 100%.	SUCCESS	f	2026-03-29 09:11:58.172517+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	EXAM_RESULT	{"score": 100, "itemId": "pre-course-test", "passed": true, "courseId": "f97933d6-66ae-4fc4-8697-93bc0eeebe17", "moduleTitle": "اختبار ما قبل الدورة"}	\N
a54c8e75-e8fb-42ba-b3bd-8f28db359ca8	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	student scored 100% on "اختبار ما قبل الدورة".	INFO	f	2026-03-29 09:11:58.179757+00	f	\N	\N	35149d1d-04f9-46f4-92d4-de88ef4d537e	\N	EXAM_RESULT	{"itemId": "pre-course-test", "passed": true, "courseId": "f97933d6-66ae-4fc4-8697-93bc0eeebe17", "studentId": "35149d1d-04f9-46f4-92d4-de88ef4d537e"}	\N
0b2fee39-622a-4c04-994e-7d29d2a55ff1	35149d1d-04f9-46f4-92d4-de88ef4d537e	"اللغة الانجليزية" has new updates from teacher.	INFO	f	2026-03-17 13:31:11.535546+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	\N
fb79b175-7b37-4959-a55c-c663e281d1ea	871ac3b1-0b01-408e-98da-0e86ae31cda3	"اللغة الانجليزية" has new updates from teacher.	INFO	f	2026-03-17 13:31:11.543112+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	\N
175e9951-3f2d-4a3a-a747-638566021ad2	d4acfbd7-c67f-417e-8cfa-410b44d14e40	"اللغة الانجليزية" has new updates from teacher.	INFO	f	2026-03-17 13:31:11.549785+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	\N
da78b1af-0532-4493-9169-af6a41555a84	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	Your course "اللغة الانجليزية" changes are live.	SUCCESS	f	2026-03-17 13:31:11.658459+00	f	\N	\N	817f9ffc-0013-43ca-a407-8fb4c4b0aeee	\N	COURSE_UPDATE	{"courseId": "91c5a9fe-797d-48ce-99e1-0fd00bf15531"}	\N
2ee3e9f8-572c-4d7d-9aee-2cd2243b1436	c01ba4d7-b28a-48cb-92a3-7188f4c7f60b	Your course "اللغة العربية" is now live.	SUCCESS	f	2026-03-29 09:14:38.212959+00	f	\N	\N	c01ba4d7-b28a-48cb-92a3-7188f4c7f60b	4d748a62-23d3-4abb-9a7d-10874feffee5	NEW_CONTENT	{"courseId": "4d748a62-23d3-4abb-9a7d-10874feffee5"}	\N
565d5609-8883-4e76-83af-663ca3ce6bc6	fe8db022-ca78-40ec-a24a-ef8db89e7d2f	Your course "السلامة والصحة المهنية حسب معايير بوشا" is now live.	SUCCESS	f	2026-04-12 08:05:09.136445+00	f	\N	\N	fe8db022-ca78-40ec-a24a-ef8db89e7d2f	909c5df3-5fa7-46d3-93a4-5ecb36cd09d0	NEW_CONTENT	{"courseId": "909c5df3-5fa7-46d3-93a4-5ecb36cd09d0"}	\N
\.


--
-- Data for Name: payment_gateway_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payment_gateway_config (id, stripe_enabled, stripe_public_key, stripe_secret_key, stripe_webhook_secret, paypal_enabled, paypal_client_id, paypal_secret_key, visa_enabled, visa_public_key, visa_secret_key, updated_by, updated_at, created_at, stripe_price_basic_monthly, stripe_price_basic_yearly, stripe_price_pro_monthly, stripe_price_pro_yearly, stripe_price_enterprise_monthly, stripe_price_enterprise_yearly, plan_basic_monthly_amount, plan_basic_monthly_currency, plan_basic_yearly_amount, plan_basic_yearly_currency, plan_pro_monthly_amount, plan_pro_monthly_currency, plan_pro_yearly_amount, plan_pro_yearly_currency, plan_enterprise_monthly_amount, plan_enterprise_monthly_currency, plan_enterprise_yearly_amount, plan_enterprise_yearly_currency) FROM stdin;
1	t	pk_live_dOv2Tl8UqpvuZ0ifVJ9soxSy	\\xc30d04070302b9d0e9ae07fd4fcd74d29c01206dd82270f307d13dd400323091dfa3212ca22e97073b38ac382757cfcd9b51e78f228bcc18c21e1d12fc987578b958b9045f6a54b55a414e3cc608e5eeb6903f711c2c95f572bb10f3c246b641df4cdd924ccc066a247121d09cb87d815eb4eaa056606915790d1cd71a2736686b71d1e6cb94188e76a5919039a1ede935017f5b46bd5c788fb1dca41249a7ab507a685be079fbe6543f1baab8	\N	f	\N	\N	f	\N	\N	\N	2026-03-04 13:33:24.184538+00	2026-02-24 10:53:16.467106+00	price_1T7FTYImE586RcrZMQOT5dUb	\N	\N	\N	\N	\N	1.00	GBP	\N	\N	20.00	USD	\N	\N	30.00	USD	\N	\N
\.


--
-- Data for Name: payment_refunds; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payment_refunds (id, payment_id, refund_id, stripe_refund_id, amount, currency, status, reason, refunded_by, refunded_by_name, refunded_at, stripe_receipt_number, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: payment_transactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payment_transactions (id, tenant_id, subscription_id, amount, currency, status, payment_method, transaction_reference, metadata, created_at, updated_at, refunded_amount, refund_status) FROM stdin;
\.


--
-- Data for Name: permissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.permissions (id, name, resource, action, description, is_system, created_at, updated_at) FROM stdin;
7f752c50-059d-4cfd-8eb1-8c790aaca302	course:create	course	create	Create new courses	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
9a5a1c10-de46-49e8-aa0a-2fd461b0dd6b	course:read	course	read	View courses	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
3db7e408-5d98-4346-a0ae-0c6b3d7b6fb0	course:update	course	update	Edit courses	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
b59636f5-2116-4eb2-ba3f-b746c21962b3	course:delete	course	delete	Delete courses	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
77ba962c-2bb8-4df8-a10a-7ddd841e79fc	course:manage	course	manage	Full course management including publishing	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
87f2997f-4b87-4da2-ab48-5a0e8292fe81	course:enroll	course	enroll	Enroll in courses	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
337242c2-fc1d-4151-ab94-e721d79fd534	user:create	user	create	Create new users	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
2d597e5d-cf68-40bb-906e-895e0cbc6134	user:read	user	read	View user profiles	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
df45cb76-e06f-4ac5-9506-43a1c4bd2891	user:update	user	update	Edit user profiles	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
3a0dbd2c-fd52-4693-975e-fab3adf926e8	user:delete	user	delete	Delete users	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
b8b1ac3e-5d04-40c5-a197-d9b3f67aef10	user:manage	user	manage	Full user management	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
ecee6041-6dc3-420e-8355-db3b56fb5291	enrollment:create	enrollment	create	Enroll users in courses	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
18dc2b23-8c09-47e9-b7ba-9c11a84b21f2	enrollment:read	enrollment	read	View enrollments	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
52403608-f000-42b9-a1fb-365842c68298	enrollment:update	enrollment	update	Modify enrollments	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
f7fe1728-746a-4281-bfa9-4414fe6bd0ad	enrollment:delete	enrollment	delete	Remove enrollments	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
e90b351c-1794-4aee-97ba-52ab60cb5002	enrollment:manage	enrollment	manage	Full enrollment management	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
e8b2badf-e8ff-4101-b3c1-eb35c3c13782	lesson:create	lesson	create	Create lessons	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
61c48f5b-3fad-437e-9a43-010af849f303	lesson:read	lesson	read	View lessons	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
963ce048-4d49-47c9-afc5-1e4db8b0ae3f	lesson:update	lesson	update	Edit lessons	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
a1e4051b-d023-4226-9528-8a24baaf7a88	lesson:delete	lesson	delete	Delete lessons	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
57172c94-590a-4e2c-aa53-544cc8306294	assignment:create	assignment	create	Create assignments	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
e685d3fb-869c-4e64-9067-6d4cf40fc889	assignment:read	assignment	read	View assignments	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
8c0ae4da-a8bb-4a22-8e41-d1688619c479	assignment:update	assignment	update	Edit assignments	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
b6a0ed9d-e06c-4f01-9f95-afbaf137e5f9	assignment:delete	assignment	delete	Delete assignments	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
86d378fe-e0bf-4e19-be40-7b55087badc2	assignment:grade	assignment	grade	Grade assignments	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
2b7e46ba-6a20-4d1e-8a88-6ef868bbd949	blog:create	blog	create	Create blog posts	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
31325563-b2a7-4357-ae87-e8d8cc3c5ec8	blog:read	blog	read	View blog posts	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
da2f42f7-f5a6-4429-830a-544808811573	blog:update	blog	update	Edit blog posts	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
8b9a2bf4-76b7-4c41-b9e7-c623f28a8785	blog:delete	blog	delete	Delete blog posts	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
f652c528-702d-4acb-97ef-577cbda5ce49	blog:publish	blog	publish	Publish blog posts	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
c2c631f4-f63a-426d-a811-263a2750cafd	report:view	report	view	View reports and analytics	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
d1d72c98-5192-4e57-bbfb-364519a038e0	report:export	report	export	Export reports	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
644add1b-67b3-44bb-8b87-c318383e92a0	settings:read	settings	read	View system settings	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
07b1a575-b02f-49a2-a662-786a382cada6	settings:update	settings	update	Modify system settings	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
930ce114-43ce-4bd8-866c-86bbaed2e06c	role:create	role	create	Create new roles	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
e23c23a6-d1d6-4bb6-a30d-c5c35133484b	role:read	role	read	View roles	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
270e00b0-4660-4f18-92a7-7233e6855329	role:update	role	update	Edit roles	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
669815cb-2374-491d-a50e-7fd54f3ae9cd	role:delete	role	delete	Delete roles	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
9d0cadaf-291c-4765-954b-d11d3ed8d515	role:assign	role	assign	Assign roles to users	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
23cf5a34-6109-4113-a93f-3277b8f8186f	payment:read	payment	read	View payment information	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
9ab92599-10b0-4f85-b1c0-e57fd9df5d3a	payment:manage	payment	manage	Manage payments and transactions	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
\.


--
-- Data for Name: provisioning_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.provisioning_logs (id, tenant_id, subdomain, status, step, message, error_details, started_at, completed_at, created_at, updated_at) FROM stdin;
e2e84118-1030-416e-9dc9-1a8ab97d7574	77ec1d51-2c26-47c7-b917-589cf643588e	reham	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-03-04 10:46:13.107477+00	2026-03-04 10:46:13.458091+00	2026-03-04 10:46:13.107477+00	2026-03-04 10:46:13.477275+00
eead2e8d-6da3-4d11-a323-fe0be8bcd5bf	77ec1d51-2c26-47c7-b917-589cf643588e	reham	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-03-04 10:46:13.481647+00	2026-03-04 10:46:14.38284+00	2026-03-04 10:46:13.481647+00	2026-03-04 10:46:14.38284+00
891ee009-ca9e-42e3-9c24-aa203c89e48b	77ec1d51-2c26-47c7-b917-589cf643588e	reham	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-03-04 10:46:14.385241+00	2026-03-04 10:46:14.392109+00	2026-03-04 10:46:14.385241+00	2026-03-04 10:46:14.392109+00
af27bfa8-c801-4d1c-9d9e-042e95bd45c8	77ec1d51-2c26-47c7-b917-589cf643588e	reham	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-03-04 10:46:14.396734+00	2026-03-04 10:46:15.216223+00	2026-03-04 10:46:14.396734+00	2026-03-04 10:46:15.216223+00
af7f0976-9c0b-4c68-bc51-f288126c2956	77ec1d51-2c26-47c7-b917-589cf643588e	reham	success	SEED_DEFAULTS	Baseline data ready	\N	2026-03-04 10:46:15.222041+00	2026-03-04 10:46:15.230393+00	2026-03-04 10:46:15.222041+00	2026-03-04 10:46:15.230393+00
1adeeb02-0f2e-4e25-96de-ae84d33a5979	77ec1d51-2c26-47c7-b917-589cf643588e	reham	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-03-04 10:46:15.24196+00	2026-03-04 10:46:15.262818+00	2026-03-04 10:46:15.24196+00	2026-03-04 10:46:15.262818+00
5ccede38-c9b2-4f55-af91-e349768b0bd1	77ec1d51-2c26-47c7-b917-589cf643588e	reham	success	CREATE_ADMIN	Admin user created	\N	2026-03-04 10:46:15.26693+00	2026-03-04 10:46:15.284269+00	2026-03-04 10:46:15.26693+00	2026-03-04 10:46:15.284269+00
acf38b59-83bd-46dd-8825-2498fe470000	77ec1d51-2c26-47c7-b917-589cf643588e	reham	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-03-04 10:46:15.291033+00	2026-03-04 10:46:15.294337+00	2026-03-04 10:46:15.291033+00	2026-03-04 10:46:15.294337+00
badaba4b-8778-4aa1-8415-369de4446e50	3d2a7d54-eef4-4e2a-bc35-531dac0f2c39	xyz	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-03-04 13:34:03.707401+00	2026-03-04 13:34:04.030155+00	2026-03-04 13:34:03.707401+00	2026-03-04 13:34:04.041876+00
9a86eebe-d05d-4591-9237-6da519995e29	3d2a7d54-eef4-4e2a-bc35-531dac0f2c39	xyz	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-03-04 13:34:04.050515+00	2026-03-04 13:34:04.449021+00	2026-03-04 13:34:04.050515+00	2026-03-04 13:34:04.449021+00
e436ec6d-48a2-4b07-be24-c7b3353264f2	3d2a7d54-eef4-4e2a-bc35-531dac0f2c39	xyz	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-03-04 13:34:04.452315+00	2026-03-04 13:34:04.462639+00	2026-03-04 13:34:04.452315+00	2026-03-04 13:34:04.462639+00
ecf551d9-eab0-4efa-873a-3137819fdb50	3d2a7d54-eef4-4e2a-bc35-531dac0f2c39	xyz	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-03-04 13:34:04.469435+00	2026-03-04 13:34:05.31908+00	2026-03-04 13:34:04.469435+00	2026-03-04 13:34:05.31908+00
acc208d0-ad45-496e-a495-3bd2c7acc96b	3d2a7d54-eef4-4e2a-bc35-531dac0f2c39	xyz	success	SEED_DEFAULTS	Baseline data ready	\N	2026-03-04 13:34:05.324468+00	2026-03-04 13:34:05.328254+00	2026-03-04 13:34:05.324468+00	2026-03-04 13:34:05.328254+00
003859c6-15c7-4f15-9ba6-7831e89c467c	3d2a7d54-eef4-4e2a-bc35-531dac0f2c39	xyz	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-03-04 13:34:05.333022+00	2026-03-04 13:34:05.353864+00	2026-03-04 13:34:05.333022+00	2026-03-04 13:34:05.353864+00
beb97675-f836-4173-ad65-8596337c1418	3d2a7d54-eef4-4e2a-bc35-531dac0f2c39	xyz	success	CREATE_ADMIN	Admin user created	\N	2026-03-04 13:34:05.358035+00	2026-03-04 13:34:05.36988+00	2026-03-04 13:34:05.358035+00	2026-03-04 13:34:05.36988+00
30af4b8a-88f7-4bfc-83a1-7302f2a72411	3d2a7d54-eef4-4e2a-bc35-531dac0f2c39	xyz	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-03-04 13:34:05.378534+00	2026-03-04 13:34:05.384301+00	2026-03-04 13:34:05.378534+00	2026-03-04 13:34:05.384301+00
e9535a28-c18a-4ba1-b02e-373add12246f	6a3960fb-4bee-435d-8c87-002eeaa5cfc3	rhema	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-03-04 14:03:14.210206+00	2026-03-04 14:03:14.392005+00	2026-03-04 14:03:14.210206+00	2026-03-04 14:03:14.400647+00
22cde400-f6f1-42ff-84b6-9bd8f18c8e67	6a3960fb-4bee-435d-8c87-002eeaa5cfc3	rhema	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-03-04 14:03:14.405962+00	2026-03-04 14:03:14.704529+00	2026-03-04 14:03:14.405962+00	2026-03-04 14:03:14.704529+00
f3eb2d29-6795-43c6-bfe8-9480b759fe14	6a3960fb-4bee-435d-8c87-002eeaa5cfc3	rhema	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-03-04 14:03:14.712718+00	2026-03-04 14:03:14.729515+00	2026-03-04 14:03:14.712718+00	2026-03-04 14:03:14.729515+00
3e7c5b83-4021-4862-ae8d-4b71f5ae212a	6a3960fb-4bee-435d-8c87-002eeaa5cfc3	rhema	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-03-04 14:03:14.73617+00	2026-03-04 14:03:15.719989+00	2026-03-04 14:03:14.73617+00	2026-03-04 14:03:15.719989+00
b747053a-6ec1-486a-8e89-9c3207112b4d	6a3960fb-4bee-435d-8c87-002eeaa5cfc3	rhema	success	SEED_DEFAULTS	Baseline data ready	\N	2026-03-04 14:03:15.723612+00	2026-03-04 14:03:15.727995+00	2026-03-04 14:03:15.723612+00	2026-03-04 14:03:15.727995+00
73b05e61-6366-450c-b19b-18a32acd047f	6a3960fb-4bee-435d-8c87-002eeaa5cfc3	rhema	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-03-04 14:03:15.739391+00	2026-03-04 14:03:15.769152+00	2026-03-04 14:03:15.739391+00	2026-03-04 14:03:15.769152+00
dc82fd27-5f9a-46ee-ab33-0e96f10712bc	6a3960fb-4bee-435d-8c87-002eeaa5cfc3	rhema	success	CREATE_ADMIN	Admin user created	\N	2026-03-04 14:03:15.772694+00	2026-03-04 14:03:15.793069+00	2026-03-04 14:03:15.772694+00	2026-03-04 14:03:15.793069+00
2c80cb56-dfad-4501-982e-0ee8b1d881b9	6a3960fb-4bee-435d-8c87-002eeaa5cfc3	rhema	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-03-04 14:03:15.79606+00	2026-03-04 14:03:15.800437+00	2026-03-04 14:03:15.79606+00	2026-03-04 14:03:15.800437+00
5086ebc9-bfef-4e63-903c-7d3d2f8670ac	b12cea5c-4611-4484-a7e1-97440c51eb68	tete	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-03-04 14:13:43.401909+00	2026-03-04 14:13:43.571372+00	2026-03-04 14:13:43.401909+00	2026-03-04 14:13:43.57925+00
e4c5009c-a482-4092-832a-9f728f3ded89	b12cea5c-4611-4484-a7e1-97440c51eb68	tete	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-03-04 14:13:43.58285+00	2026-03-04 14:13:43.937351+00	2026-03-04 14:13:43.58285+00	2026-03-04 14:13:43.937351+00
bc3b5850-8499-4dd4-9c3b-b3634e8876e4	b12cea5c-4611-4484-a7e1-97440c51eb68	tete	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-03-04 14:13:43.943658+00	2026-03-04 14:13:43.961414+00	2026-03-04 14:13:43.943658+00	2026-03-04 14:13:43.961414+00
e1456f22-028a-47a2-9318-774ebb3a2659	b12cea5c-4611-4484-a7e1-97440c51eb68	tete	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-03-04 14:13:43.973738+00	2026-03-04 14:13:44.950085+00	2026-03-04 14:13:43.973738+00	2026-03-04 14:13:44.950085+00
5da763a4-1dab-4004-b193-91ebffd833b4	b12cea5c-4611-4484-a7e1-97440c51eb68	tete	success	SEED_DEFAULTS	Baseline data ready	\N	2026-03-04 14:13:44.962934+00	2026-03-04 14:13:44.965596+00	2026-03-04 14:13:44.962934+00	2026-03-04 14:13:44.965596+00
18cdb0b5-2e7f-49d3-ac2f-75f1db9db086	b12cea5c-4611-4484-a7e1-97440c51eb68	tete	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-03-04 14:13:44.968635+00	2026-03-04 14:13:44.982762+00	2026-03-04 14:13:44.968635+00	2026-03-04 14:13:44.982762+00
957f0858-b4bd-4326-97a0-aeb592547209	b12cea5c-4611-4484-a7e1-97440c51eb68	tete	success	CREATE_ADMIN	Admin user created	\N	2026-03-04 14:13:44.984771+00	2026-03-04 14:13:45.062978+00	2026-03-04 14:13:44.984771+00	2026-03-04 14:13:45.062978+00
e87e9e39-6ef4-402d-9ce9-9fa5ab113440	b12cea5c-4611-4484-a7e1-97440c51eb68	tete	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-03-04 14:13:45.066903+00	2026-03-04 14:13:45.071906+00	2026-03-04 14:13:45.066903+00	2026-03-04 14:13:45.071906+00
4b5e27cf-0ee4-4e90-a059-b44d7064d9b7	a4f738cf-78ff-4291-9a36-ed20adff3934	yoyo	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-03-04 14:14:45.634556+00	2026-03-04 14:14:45.960266+00	2026-03-04 14:14:45.634556+00	2026-03-04 14:14:45.963657+00
9f03868d-3045-4d57-bc85-89bb4c82c50d	a4f738cf-78ff-4291-9a36-ed20adff3934	yoyo	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-03-04 14:14:45.965482+00	2026-03-04 14:14:46.192466+00	2026-03-04 14:14:45.965482+00	2026-03-04 14:14:46.192466+00
7515553d-eea0-460f-91be-92f7913f7024	a4f738cf-78ff-4291-9a36-ed20adff3934	yoyo	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-03-04 14:14:46.196591+00	2026-03-04 14:14:46.202073+00	2026-03-04 14:14:46.196591+00	2026-03-04 14:14:46.202073+00
e31e1354-56a7-4177-95cb-d658a2506cad	a4f738cf-78ff-4291-9a36-ed20adff3934	yoyo	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-03-04 14:14:46.205058+00	2026-03-04 14:14:46.660976+00	2026-03-04 14:14:46.205058+00	2026-03-04 14:14:46.660976+00
3ff3184c-f8fe-4216-92a0-8bba6443ed15	a4f738cf-78ff-4291-9a36-ed20adff3934	yoyo	success	SEED_DEFAULTS	Baseline data ready	\N	2026-03-04 14:14:46.662835+00	2026-03-04 14:14:46.664611+00	2026-03-04 14:14:46.662835+00	2026-03-04 14:14:46.664611+00
d29640c4-3367-408e-8e63-a8b0b8073f2b	a4f738cf-78ff-4291-9a36-ed20adff3934	yoyo	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-03-04 14:14:46.666574+00	2026-03-04 14:14:46.679391+00	2026-03-04 14:14:46.666574+00	2026-03-04 14:14:46.679391+00
83b3f2ea-12ef-44e0-a3e0-91101fc1c7fa	a4f738cf-78ff-4291-9a36-ed20adff3934	yoyo	success	CREATE_ADMIN	Admin user created	\N	2026-03-04 14:14:46.683661+00	2026-03-04 14:14:46.690234+00	2026-03-04 14:14:46.683661+00	2026-03-04 14:14:46.690234+00
dba35550-a863-42cf-bb0a-d4501f2b0fdb	a4f738cf-78ff-4291-9a36-ed20adff3934	yoyo	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-03-04 14:14:46.691764+00	2026-03-04 14:14:46.693572+00	2026-03-04 14:14:46.691764+00	2026-03-04 14:14:46.693572+00
19d30bf6-bd0d-4bdd-9992-1e2ae085e6e9	4ead1eb0-8dab-419d-953e-76e0142d80a5	tetette	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-03-04 14:21:33.138847+00	2026-03-04 14:21:33.21533+00	2026-03-04 14:21:33.138847+00	2026-03-04 14:21:33.222277+00
bf38aa81-1b65-4892-a590-eef8fbc5fb48	4ead1eb0-8dab-419d-953e-76e0142d80a5	tetette	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-03-04 14:21:33.224278+00	2026-03-04 14:21:33.431146+00	2026-03-04 14:21:33.224278+00	2026-03-04 14:21:33.431146+00
0b66204e-8e9d-40c7-9cb2-abc5fe89256b	4ead1eb0-8dab-419d-953e-76e0142d80a5	tetette	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-03-04 14:21:33.433376+00	2026-03-04 14:21:33.438349+00	2026-03-04 14:21:33.433376+00	2026-03-04 14:21:33.438349+00
b3ee6076-86f0-43c2-9939-e94cdf386b10	4ead1eb0-8dab-419d-953e-76e0142d80a5	tetette	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-03-04 14:21:33.441003+00	2026-03-04 14:21:34.321556+00	2026-03-04 14:21:33.441003+00	2026-03-04 14:21:34.321556+00
e601e22b-d8f1-4b97-85ae-024d63ae6199	4ead1eb0-8dab-419d-953e-76e0142d80a5	tetette	success	SEED_DEFAULTS	Baseline data ready	\N	2026-03-04 14:21:34.323297+00	2026-03-04 14:21:34.325451+00	2026-03-04 14:21:34.323297+00	2026-03-04 14:21:34.325451+00
d431803a-3d28-457b-9fc1-06049069014f	4ead1eb0-8dab-419d-953e-76e0142d80a5	tetette	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-03-04 14:21:34.326879+00	2026-03-04 14:21:34.338157+00	2026-03-04 14:21:34.326879+00	2026-03-04 14:21:34.338157+00
10c44fe0-bc8c-4a7a-88ae-55ef5e6f757c	4ead1eb0-8dab-419d-953e-76e0142d80a5	tetette	success	CREATE_ADMIN	Admin user created	\N	2026-03-04 14:21:34.339609+00	2026-03-04 14:21:34.349795+00	2026-03-04 14:21:34.339609+00	2026-03-04 14:21:34.349795+00
ae578823-ca31-4e68-8cad-79e9e7f5c9fd	4ead1eb0-8dab-419d-953e-76e0142d80a5	tetette	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-03-04 14:21:34.352835+00	2026-03-04 14:21:34.35511+00	2026-03-04 14:21:34.352835+00	2026-03-04 14:21:34.35511+00
40f483aa-b021-44ea-9bd7-f8b18d7a3d53	a19d448c-0018-466f-8f35-0b8eaf01e2f9	lara	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-03-04 14:48:10.506395+00	2026-03-04 14:48:10.600756+00	2026-03-04 14:48:10.506395+00	2026-03-04 14:48:10.605662+00
a4d70b5a-b531-43b2-9164-fab916236169	a19d448c-0018-466f-8f35-0b8eaf01e2f9	lara	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-03-04 14:48:10.609209+00	2026-03-04 14:48:10.762349+00	2026-03-04 14:48:10.609209+00	2026-03-04 14:48:10.762349+00
40f4f121-0181-4f1f-88a9-183779732c10	74bf2ead-ebc3-4061-a988-778c2a16ff9e	poshacademy	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-03-04 15:00:39.243716+00	2026-03-04 15:00:39.348728+00	2026-03-04 15:00:39.243716+00	2026-03-04 15:00:39.354646+00
f5936994-b870-4b16-867b-02480355258c	a19d448c-0018-466f-8f35-0b8eaf01e2f9	lara	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-03-04 14:48:10.767173+00	2026-03-04 14:48:10.774881+00	2026-03-04 14:48:10.767173+00	2026-03-04 14:48:10.774881+00
c7abac96-6523-4cba-ad60-2ec1488a1d43	a19d448c-0018-466f-8f35-0b8eaf01e2f9	lara	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-03-04 14:48:10.778238+00	2026-03-04 14:48:11.222884+00	2026-03-04 14:48:10.778238+00	2026-03-04 14:48:11.222884+00
5d53c082-6293-49a8-8940-0ea0d9b4ad8c	74bf2ead-ebc3-4061-a988-778c2a16ff9e	poshacademy	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-03-04 15:00:39.364077+00	2026-03-04 15:00:39.561561+00	2026-03-04 15:00:39.364077+00	2026-03-04 15:00:39.561561+00
8818ca26-0e89-4bd7-8e09-42719162ecad	a19d448c-0018-466f-8f35-0b8eaf01e2f9	lara	success	SEED_DEFAULTS	Baseline data ready	\N	2026-03-04 14:48:11.22838+00	2026-03-04 14:48:11.230251+00	2026-03-04 14:48:11.22838+00	2026-03-04 14:48:11.230251+00
1d84d93e-c93e-428b-801c-edcc2dce3d9a	a19d448c-0018-466f-8f35-0b8eaf01e2f9	lara	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-03-04 14:48:11.232127+00	2026-03-04 14:48:11.242893+00	2026-03-04 14:48:11.232127+00	2026-03-04 14:48:11.242893+00
4eeeb81b-f8f8-4e80-ac99-b1ec5d4e2761	74bf2ead-ebc3-4061-a988-778c2a16ff9e	poshacademy	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-03-04 15:00:39.567715+00	2026-03-04 15:00:39.574526+00	2026-03-04 15:00:39.567715+00	2026-03-04 15:00:39.574526+00
682c1234-bbc7-4b25-80d5-d4a2f19d0e84	a19d448c-0018-466f-8f35-0b8eaf01e2f9	lara	success	CREATE_ADMIN	Admin user created	\N	2026-03-04 14:48:11.247483+00	2026-03-04 14:48:11.255389+00	2026-03-04 14:48:11.247483+00	2026-03-04 14:48:11.255389+00
57f7048a-2498-4420-9bf8-ae6a1db9b072	a19d448c-0018-466f-8f35-0b8eaf01e2f9	lara	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-03-04 14:48:11.258913+00	2026-03-04 14:48:11.261626+00	2026-03-04 14:48:11.258913+00	2026-03-04 14:48:11.261626+00
434db2e0-4030-4a8e-ba7a-a9d10161fb0a	74bf2ead-ebc3-4061-a988-778c2a16ff9e	poshacademy	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-03-04 15:00:39.578779+00	2026-03-04 15:00:40.150905+00	2026-03-04 15:00:39.578779+00	2026-03-04 15:00:40.150905+00
7eac6acd-336f-4f83-a2b9-e1de0c6cd7d8	74bf2ead-ebc3-4061-a988-778c2a16ff9e	poshacademy	success	SEED_DEFAULTS	Baseline data ready	\N	2026-03-04 15:00:40.154021+00	2026-03-04 15:00:40.156827+00	2026-03-04 15:00:40.154021+00	2026-03-04 15:00:40.156827+00
31ff63d1-9631-4deb-87cc-b3c73b894343	74bf2ead-ebc3-4061-a988-778c2a16ff9e	poshacademy	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-03-04 15:00:40.234488+00	2026-03-04 15:00:40.246102+00	2026-03-04 15:00:40.234488+00	2026-03-04 15:00:40.246102+00
b1c3238f-3dc6-4b5b-a4ac-34b96132f88e	74bf2ead-ebc3-4061-a988-778c2a16ff9e	poshacademy	success	CREATE_ADMIN	Admin user created	\N	2026-03-04 15:00:40.248402+00	2026-03-04 15:00:40.258229+00	2026-03-04 15:00:40.248402+00	2026-03-04 15:00:40.258229+00
843bfb49-575a-4789-8e65-8647a939f53d	74bf2ead-ebc3-4061-a988-778c2a16ff9e	poshacademy	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-03-04 15:00:40.260422+00	2026-03-04 15:00:40.263171+00	2026-03-04 15:00:40.260422+00	2026-03-04 15:00:40.263171+00
5753f29f-78e5-48ba-a978-a5461b31244e	60a51aeb-86f2-442b-81e0-d2d07821af46	test	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-03-04 15:12:44.843983+00	2026-03-04 15:12:44.958387+00	2026-03-04 15:12:44.843983+00	2026-03-04 15:12:44.974544+00
49708e5d-6f6f-4ff1-94ab-8e059a055f5b	60a51aeb-86f2-442b-81e0-d2d07821af46	test	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-03-04 15:12:44.978955+00	2026-03-04 15:12:45.198165+00	2026-03-04 15:12:44.978955+00	2026-03-04 15:12:45.198165+00
35a8d422-baad-4332-914c-cc3df5e7450d	60a51aeb-86f2-442b-81e0-d2d07821af46	test	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-03-04 15:12:45.200528+00	2026-03-04 15:12:45.205402+00	2026-03-04 15:12:45.200528+00	2026-03-04 15:12:45.205402+00
f2cd6883-3836-417e-9344-44898f8507b4	60a51aeb-86f2-442b-81e0-d2d07821af46	test	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-03-04 15:12:45.2131+00	2026-03-04 15:12:45.919688+00	2026-03-04 15:12:45.2131+00	2026-03-04 15:12:45.919688+00
e28a5a81-6942-4cae-9a20-e173ab5e76f2	60a51aeb-86f2-442b-81e0-d2d07821af46	test	success	SEED_DEFAULTS	Baseline data ready	\N	2026-03-04 15:12:45.923764+00	2026-03-04 15:12:45.925524+00	2026-03-04 15:12:45.923764+00	2026-03-04 15:12:45.925524+00
3e9eeda4-ec19-4718-9437-5d79d24ee596	60a51aeb-86f2-442b-81e0-d2d07821af46	test	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-03-04 15:12:45.928042+00	2026-03-04 15:12:45.954856+00	2026-03-04 15:12:45.928042+00	2026-03-04 15:12:45.954856+00
0c84b3c8-5d56-44e5-ae7c-a2ee67959d02	60a51aeb-86f2-442b-81e0-d2d07821af46	test	success	CREATE_ADMIN	Admin user created	\N	2026-03-04 15:12:45.959904+00	2026-03-04 15:12:45.969777+00	2026-03-04 15:12:45.959904+00	2026-03-04 15:12:45.969777+00
22c24399-c0dc-45b1-bdc7-a2fd084c1a38	60a51aeb-86f2-442b-81e0-d2d07821af46	test	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-03-04 15:12:45.973833+00	2026-03-04 15:12:45.976247+00	2026-03-04 15:12:45.973833+00	2026-03-04 15:12:45.976247+00
dd806514-cd66-493f-83d7-03265b376f16	22ab2fce-c868-4648-8fdf-8eb629f9a494	reham1	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-03-05 09:10:31.918025+00	2026-03-05 09:10:32.187446+00	2026-03-05 09:10:31.918025+00	2026-03-05 09:10:32.191521+00
7f7e3fae-db63-4846-a463-916c9f09efae	22ab2fce-c868-4648-8fdf-8eb629f9a494	reham1	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-03-05 09:10:32.195251+00	2026-03-05 09:10:32.421464+00	2026-03-05 09:10:32.195251+00	2026-03-05 09:10:32.421464+00
f6207821-8de0-49d7-b9f8-9bfeeff7fc49	22ab2fce-c868-4648-8fdf-8eb629f9a494	reham1	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-03-05 09:10:32.424291+00	2026-03-05 09:10:32.431788+00	2026-03-05 09:10:32.424291+00	2026-03-05 09:10:32.431788+00
da2fdaa7-c7d3-47bf-b51f-4763ccc9c423	22ab2fce-c868-4648-8fdf-8eb629f9a494	reham1	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-03-05 09:10:32.435234+00	2026-03-05 09:10:33.098096+00	2026-03-05 09:10:32.435234+00	2026-03-05 09:10:33.098096+00
f6e0ac79-b55f-4a4a-b560-39232b80e9c7	22ab2fce-c868-4648-8fdf-8eb629f9a494	reham1	success	SEED_DEFAULTS	Baseline data ready	\N	2026-03-05 09:10:33.103152+00	2026-03-05 09:10:33.106199+00	2026-03-05 09:10:33.103152+00	2026-03-05 09:10:33.106199+00
9d85514c-21ff-4db8-8bea-76f6faa61838	22ab2fce-c868-4648-8fdf-8eb629f9a494	reham1	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-03-05 09:10:33.110598+00	2026-03-05 09:10:33.124062+00	2026-03-05 09:10:33.110598+00	2026-03-05 09:10:33.124062+00
be847969-198f-4cb4-9225-e2138d037f88	22ab2fce-c868-4648-8fdf-8eb629f9a494	reham1	success	CREATE_ADMIN	Admin user created	\N	2026-03-05 09:10:33.127062+00	2026-03-05 09:10:33.140589+00	2026-03-05 09:10:33.127062+00	2026-03-05 09:10:33.140589+00
3bba640b-9112-4a7c-adaf-1dc027efd677	22ab2fce-c868-4648-8fdf-8eb629f9a494	reham1	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-03-05 09:10:33.145456+00	2026-03-05 09:10:33.148723+00	2026-03-05 09:10:33.145456+00	2026-03-05 09:10:33.148723+00
73e49900-a199-42b5-8506-d6dcded31243	7b05964c-da31-4212-9471-b9384d575715	sasha	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-03-08 13:07:12.095652+00	2026-03-08 13:07:12.227387+00	2026-03-08 13:07:12.095652+00	2026-03-08 13:07:12.23746+00
7a9e9cae-972e-4246-b923-cadb8c11a8f4	7b05964c-da31-4212-9471-b9384d575715	sasha	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-03-08 13:07:12.245258+00	2026-03-08 13:07:12.603469+00	2026-03-08 13:07:12.245258+00	2026-03-08 13:07:12.603469+00
ce831c2e-bc47-4c54-9e7c-5a0e14f7f44f	7b05964c-da31-4212-9471-b9384d575715	sasha	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-03-08 13:07:12.611428+00	2026-03-08 13:07:12.626146+00	2026-03-08 13:07:12.611428+00	2026-03-08 13:07:12.626146+00
4b937f83-bcf3-48b0-a62c-11c0dd86cd5d	7b05964c-da31-4212-9471-b9384d575715	sasha	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-03-08 13:07:12.64185+00	2026-03-08 13:07:13.647028+00	2026-03-08 13:07:12.64185+00	2026-03-08 13:07:13.647028+00
327fe3a1-8a36-4a44-9415-1cdc91e14756	7b05964c-da31-4212-9471-b9384d575715	sasha	success	SEED_DEFAULTS	Baseline data ready	\N	2026-03-08 13:07:13.655136+00	2026-03-08 13:07:13.661994+00	2026-03-08 13:07:13.655136+00	2026-03-08 13:07:13.661994+00
8bfa64e9-c892-4525-8629-575c46ecd1bd	7b05964c-da31-4212-9471-b9384d575715	sasha	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-03-08 13:07:13.671209+00	2026-03-08 13:07:13.704994+00	2026-03-08 13:07:13.671209+00	2026-03-08 13:07:13.704994+00
17f97e47-c247-4fac-af10-a3c6ef8b760e	7b05964c-da31-4212-9471-b9384d575715	sasha	success	CREATE_ADMIN	Admin user created	\N	2026-03-08 13:07:13.712716+00	2026-03-08 13:07:13.7361+00	2026-03-08 13:07:13.712716+00	2026-03-08 13:07:13.7361+00
bc5deee7-1c4b-4064-bc2d-653fd7d44142	7b05964c-da31-4212-9471-b9384d575715	sasha	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-03-08 13:07:13.743206+00	2026-03-08 13:07:13.752024+00	2026-03-08 13:07:13.743206+00	2026-03-08 13:07:13.752024+00
df7f211b-25b2-49a4-b0f4-16886671dcf4	ac199157-3bc3-4792-9f84-4b6b80026d19	upacs	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-03-10 12:07:03.457965+00	2026-03-10 12:07:03.651301+00	2026-03-10 12:07:03.457965+00	2026-03-10 12:07:03.659376+00
a42a720c-a4a7-4e43-ac60-3723c640228f	ac199157-3bc3-4792-9f84-4b6b80026d19	upacs	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-03-10 12:07:03.666773+00	2026-03-10 12:07:03.884205+00	2026-03-10 12:07:03.666773+00	2026-03-10 12:07:03.884205+00
f3235489-c81a-4de2-8ecb-5a8daa196fd2	ac199157-3bc3-4792-9f84-4b6b80026d19	upacs	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-03-10 12:07:03.891843+00	2026-03-10 12:07:03.90593+00	2026-03-10 12:07:03.891843+00	2026-03-10 12:07:03.90593+00
8cb6eab3-5f46-47c1-ac79-a518afb472d4	ac199157-3bc3-4792-9f84-4b6b80026d19	upacs	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-03-10 12:07:03.922491+00	2026-03-10 12:07:04.908839+00	2026-03-10 12:07:03.922491+00	2026-03-10 12:07:04.908839+00
d0973da0-932b-464b-93d0-64ee94721864	ac199157-3bc3-4792-9f84-4b6b80026d19	upacs	success	SEED_DEFAULTS	Baseline data ready	\N	2026-03-10 12:07:04.915345+00	2026-03-10 12:07:04.925563+00	2026-03-10 12:07:04.915345+00	2026-03-10 12:07:04.925563+00
642d085c-0224-4efc-9965-e801259a26f8	ac199157-3bc3-4792-9f84-4b6b80026d19	upacs	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-03-10 12:07:04.931564+00	2026-03-10 12:07:04.964094+00	2026-03-10 12:07:04.931564+00	2026-03-10 12:07:04.964094+00
ac60a2af-79ed-422e-987f-a14e7f0aa867	ac199157-3bc3-4792-9f84-4b6b80026d19	upacs	success	CREATE_ADMIN	Admin user created	\N	2026-03-10 12:07:04.974279+00	2026-03-10 12:07:04.996427+00	2026-03-10 12:07:04.974279+00	2026-03-10 12:07:04.996427+00
12036637-6ff8-45b4-8e62-dad15e832448	ac199157-3bc3-4792-9f84-4b6b80026d19	upacs	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-03-10 12:07:05.003604+00	2026-03-10 12:07:05.020209+00	2026-03-10 12:07:05.003604+00	2026-03-10 12:07:05.020209+00
0e41356c-9a14-445a-95ae-f6665b7e3e8b	6307963b-7063-4202-80c3-0200b33218c6	abc	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-03-10 12:20:40.992513+00	2026-03-10 12:20:41.170266+00	2026-03-10 12:20:40.992513+00	2026-03-10 12:20:41.177679+00
bc8d743c-bd00-4559-b721-4de5acd0f4b0	67cc3fea-70d6-4c48-87c4-93fee941cc53	beauty	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-04-26 07:29:44.785387+00	2026-04-26 07:29:44.934565+00	2026-04-26 07:29:44.785387+00	2026-04-26 07:29:44.938598+00
f75f2095-4c5a-43be-a073-80c2846e4d30	6307963b-7063-4202-80c3-0200b33218c6	abc	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-03-10 12:20:41.18408+00	2026-03-10 12:20:41.425083+00	2026-03-10 12:20:41.18408+00	2026-03-10 12:20:41.425083+00
a5c40805-1820-4356-a503-f09407ad1d36	6307963b-7063-4202-80c3-0200b33218c6	abc	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-03-10 12:20:41.431647+00	2026-03-10 12:20:41.445572+00	2026-03-10 12:20:41.431647+00	2026-03-10 12:20:41.445572+00
7b452c49-e409-4bf3-89d6-7f9ce999e189	67cc3fea-70d6-4c48-87c4-93fee941cc53	beauty	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-04-26 07:29:44.940703+00	2026-04-26 07:29:45.100257+00	2026-04-26 07:29:44.940703+00	2026-04-26 07:29:45.100257+00
3a15d711-10ae-485d-ba46-ed4df2c6ee82	6307963b-7063-4202-80c3-0200b33218c6	abc	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-03-10 12:20:41.457376+00	2026-03-10 12:20:42.280366+00	2026-03-10 12:20:41.457376+00	2026-03-10 12:20:42.280366+00
6314790b-1cb1-4661-bc79-4465037af6f9	6307963b-7063-4202-80c3-0200b33218c6	abc	success	SEED_DEFAULTS	Baseline data ready	\N	2026-03-10 12:20:42.28917+00	2026-03-10 12:20:42.295722+00	2026-03-10 12:20:42.28917+00	2026-03-10 12:20:42.295722+00
cbba0adb-0d10-408d-ba5b-03ad0fb3d075	67cc3fea-70d6-4c48-87c4-93fee941cc53	beauty	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-04-26 07:29:45.102393+00	2026-04-26 07:29:45.107138+00	2026-04-26 07:29:45.102393+00	2026-04-26 07:29:45.107138+00
601e5987-6b29-4f6e-ae9a-80354dbd014e	6307963b-7063-4202-80c3-0200b33218c6	abc	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-03-10 12:20:42.302069+00	2026-03-10 12:20:42.329626+00	2026-03-10 12:20:42.302069+00	2026-03-10 12:20:42.329626+00
081ba482-1cbe-43f4-8153-237129ab9633	6307963b-7063-4202-80c3-0200b33218c6	abc	success	CREATE_ADMIN	Admin user created	\N	2026-03-10 12:20:42.336091+00	2026-03-10 12:20:42.357475+00	2026-03-10 12:20:42.336091+00	2026-03-10 12:20:42.357475+00
3dbf60e5-ff7c-45a0-851d-e359298d1a03	67cc3fea-70d6-4c48-87c4-93fee941cc53	beauty	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-04-26 07:29:45.111495+00	2026-04-26 07:29:45.568587+00	2026-04-26 07:29:45.111495+00	2026-04-26 07:29:45.568587+00
a59b9096-8060-4f45-84a3-1715c71b3497	6307963b-7063-4202-80c3-0200b33218c6	abc	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-03-10 12:20:42.364316+00	2026-03-10 12:20:42.37696+00	2026-03-10 12:20:42.364316+00	2026-03-10 12:20:42.37696+00
07d798e1-786c-4357-9435-9a990f72ba18	67cc3fea-70d6-4c48-87c4-93fee941cc53	beauty	success	SEED_DEFAULTS	Baseline data ready	\N	2026-04-26 07:29:45.570524+00	2026-04-26 07:29:45.572327+00	2026-04-26 07:29:45.570524+00	2026-04-26 07:29:45.572327+00
82dad183-7bf1-41d7-be94-da193ea914c4	1da3fada-f597-4a2a-86c1-41cbb19dd456	abona	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-03-10 12:25:57.717459+00	2026-03-10 12:25:57.917911+00	2026-03-10 12:25:57.717459+00	2026-03-10 12:25:57.929427+00
cff42f20-6025-4c18-950c-7e111bf8597d	1da3fada-f597-4a2a-86c1-41cbb19dd456	abona	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-03-10 12:25:57.937774+00	2026-03-10 12:25:58.526854+00	2026-03-10 12:25:57.937774+00	2026-03-10 12:25:58.526854+00
dabad40d-2317-46cd-9a00-1800f9514ba3	67cc3fea-70d6-4c48-87c4-93fee941cc53	beauty	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-04-26 07:29:45.573952+00	2026-04-26 07:29:45.581333+00	2026-04-26 07:29:45.573952+00	2026-04-26 07:29:45.581333+00
8e25243e-3754-4b42-b8a0-e8d6725c4021	1da3fada-f597-4a2a-86c1-41cbb19dd456	abona	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-03-10 12:25:58.534124+00	2026-03-10 12:25:58.552059+00	2026-03-10 12:25:58.534124+00	2026-03-10 12:25:58.552059+00
8328b0c5-7f74-4407-9448-6a4881a3398e	1da3fada-f597-4a2a-86c1-41cbb19dd456	abona	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-03-10 12:25:58.5658+00	2026-03-10 12:25:59.698308+00	2026-03-10 12:25:58.5658+00	2026-03-10 12:25:59.698308+00
26f8b8b2-e559-4f82-b62f-988e906a50d3	67cc3fea-70d6-4c48-87c4-93fee941cc53	beauty	success	CREATE_ADMIN	Admin user created	\N	2026-04-26 07:29:45.58293+00	2026-04-26 07:29:45.589445+00	2026-04-26 07:29:45.58293+00	2026-04-26 07:29:45.589445+00
0b88417a-8ec7-45ac-bb22-e38e184eb81f	1da3fada-f597-4a2a-86c1-41cbb19dd456	abona	success	SEED_DEFAULTS	Baseline data ready	\N	2026-03-10 12:25:59.70525+00	2026-03-10 12:25:59.712392+00	2026-03-10 12:25:59.70525+00	2026-03-10 12:25:59.712392+00
b7053d53-d582-452e-8674-359a0e55737f	1da3fada-f597-4a2a-86c1-41cbb19dd456	abona	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-03-10 12:25:59.720767+00	2026-03-10 12:25:59.754883+00	2026-03-10 12:25:59.720767+00	2026-03-10 12:25:59.754883+00
424943b8-4946-43d8-b5da-33a02f66a9d9	67cc3fea-70d6-4c48-87c4-93fee941cc53	beauty	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-04-26 07:29:45.591485+00	2026-04-26 07:29:45.595294+00	2026-04-26 07:29:45.591485+00	2026-04-26 07:29:45.595294+00
c2db48eb-4da0-44ec-b8a7-c7359a112125	1da3fada-f597-4a2a-86c1-41cbb19dd456	abona	success	CREATE_ADMIN	Admin user created	\N	2026-03-10 12:25:59.762+00	2026-03-10 12:25:59.785898+00	2026-03-10 12:25:59.762+00	2026-03-10 12:25:59.785898+00
b1a04fa8-e53a-42a8-8385-35bd5ac58173	1da3fada-f597-4a2a-86c1-41cbb19dd456	abona	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-03-10 12:25:59.792312+00	2026-03-10 12:25:59.8073+00	2026-03-10 12:25:59.792312+00	2026-03-10 12:25:59.8073+00
4eb5d29a-0d1b-4b30-b112-511e18de23c6	b524ae48-9a4e-467f-bdcf-1a6ee78d5c3c	demo	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-04-27 05:30:52.67213+00	2026-04-27 05:30:52.937964+00	2026-04-27 05:30:52.67213+00	2026-04-27 05:30:52.944336+00
eaf564ef-bf93-4871-b757-33a7a6506dc6	fd0698bf-7c64-4cc6-939f-216e24111483	wego-academy	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-04-25 18:04:07.308781+00	2026-04-25 18:04:07.459597+00	2026-04-25 18:04:07.308781+00	2026-04-25 18:04:07.463508+00
48bcb600-8f31-449a-ab29-50e67240b882	fd0698bf-7c64-4cc6-939f-216e24111483	wego-academy	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-04-25 18:04:07.466689+00	2026-04-25 18:04:07.672954+00	2026-04-25 18:04:07.466689+00	2026-04-25 18:04:07.672954+00
1b71c1df-6757-41b5-a205-b7c62d3f050a	b524ae48-9a4e-467f-bdcf-1a6ee78d5c3c	demo	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-04-27 05:30:52.946371+00	2026-04-27 05:30:53.096307+00	2026-04-27 05:30:52.946371+00	2026-04-27 05:30:53.096307+00
598f37b1-8c90-4ddd-8bb5-92021481c538	fd0698bf-7c64-4cc6-939f-216e24111483	wego-academy	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-04-25 18:04:07.674806+00	2026-04-25 18:04:07.678829+00	2026-04-25 18:04:07.674806+00	2026-04-25 18:04:07.678829+00
323b0d20-ad7f-43af-8415-b0e7df94d185	fd0698bf-7c64-4cc6-939f-216e24111483	wego-academy	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-04-25 18:04:07.682248+00	2026-04-25 18:04:08.278267+00	2026-04-25 18:04:07.682248+00	2026-04-25 18:04:08.278267+00
29ab62af-34b7-4019-a19a-418219d23605	b524ae48-9a4e-467f-bdcf-1a6ee78d5c3c	demo	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-04-27 05:30:53.099432+00	2026-04-27 05:30:53.104395+00	2026-04-27 05:30:53.099432+00	2026-04-27 05:30:53.104395+00
9555bd9a-0e80-494d-85a5-df82f729b047	fd0698bf-7c64-4cc6-939f-216e24111483	wego-academy	success	SEED_DEFAULTS	Baseline data ready	\N	2026-04-25 18:04:08.281333+00	2026-04-25 18:04:08.284746+00	2026-04-25 18:04:08.281333+00	2026-04-25 18:04:08.284746+00
a2209c9e-2137-4847-b8f8-e5340d14f022	fd0698bf-7c64-4cc6-939f-216e24111483	wego-academy	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-04-25 18:04:08.287669+00	2026-04-25 18:04:08.299616+00	2026-04-25 18:04:08.287669+00	2026-04-25 18:04:08.299616+00
911814c5-9c75-457f-a056-ceabb9886d76	b524ae48-9a4e-467f-bdcf-1a6ee78d5c3c	demo	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-04-27 05:30:53.107154+00	2026-04-27 05:30:53.599895+00	2026-04-27 05:30:53.107154+00	2026-04-27 05:30:53.599895+00
80dc8b29-10a1-47d7-a068-634459ae6b66	fd0698bf-7c64-4cc6-939f-216e24111483	wego-academy	success	CREATE_ADMIN	Admin user created	\N	2026-04-25 18:04:08.301916+00	2026-04-25 18:04:08.312701+00	2026-04-25 18:04:08.301916+00	2026-04-25 18:04:08.312701+00
1006a3ab-9965-4a2e-8f4a-fa0e080f40a3	fd0698bf-7c64-4cc6-939f-216e24111483	wego-academy	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-04-25 18:04:08.314953+00	2026-04-25 18:04:08.320467+00	2026-04-25 18:04:08.314953+00	2026-04-25 18:04:08.320467+00
7f19ed1b-9017-4665-aa1c-7197cec7d347	b524ae48-9a4e-467f-bdcf-1a6ee78d5c3c	demo	success	SEED_DEFAULTS	Baseline data ready	\N	2026-04-27 05:30:53.601987+00	2026-04-27 05:30:53.604338+00	2026-04-27 05:30:53.601987+00	2026-04-27 05:30:53.604338+00
a1a9a296-a5ed-43f9-ad82-a8ed1fa838b1	b524ae48-9a4e-467f-bdcf-1a6ee78d5c3c	demo	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-04-27 05:30:53.60666+00	2026-04-27 05:30:53.617341+00	2026-04-27 05:30:53.60666+00	2026-04-27 05:30:53.617341+00
ad4481e3-2783-42c9-9bc2-1c74889155a2	b524ae48-9a4e-467f-bdcf-1a6ee78d5c3c	demo	success	CREATE_ADMIN	Admin user created	\N	2026-04-27 05:30:53.619108+00	2026-04-27 05:30:53.626578+00	2026-04-27 05:30:53.619108+00	2026-04-27 05:30:53.626578+00
b2ccfded-8e39-4fac-b881-496b88a1d54f	b524ae48-9a4e-467f-bdcf-1a6ee78d5c3c	demo	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-04-27 05:30:53.628842+00	2026-04-27 05:30:53.632576+00	2026-04-27 05:30:53.628842+00	2026-04-27 05:30:53.632576+00
3badee7f-d6e1-4ecb-902b-fe8827827811	8c46ae66-f491-4d42-9ec6-62a9800dff18	wego	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-04-28 17:48:51.932143+00	2026-04-28 17:48:52.079408+00	2026-04-28 17:48:51.932143+00	2026-04-28 17:48:52.083205+00
7047f284-d688-4f7d-b8fa-8f68e74c88fb	8c46ae66-f491-4d42-9ec6-62a9800dff18	wego	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-04-28 17:48:52.085743+00	2026-04-28 17:48:52.321882+00	2026-04-28 17:48:52.085743+00	2026-04-28 17:48:52.321882+00
988e1dc0-f6d3-4588-a99b-f0dcc34b4024	8c46ae66-f491-4d42-9ec6-62a9800dff18	wego	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-04-28 17:48:52.32402+00	2026-04-28 17:48:52.327776+00	2026-04-28 17:48:52.32402+00	2026-04-28 17:48:52.327776+00
c65837c4-991f-4842-85d6-39ef4b9d7e14	8c46ae66-f491-4d42-9ec6-62a9800dff18	wego	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-04-28 17:48:52.330154+00	2026-04-28 17:48:52.813219+00	2026-04-28 17:48:52.330154+00	2026-04-28 17:48:52.813219+00
2a513cc1-6c28-4778-8729-7d4f8213998d	8c46ae66-f491-4d42-9ec6-62a9800dff18	wego	success	SEED_DEFAULTS	Baseline data ready	\N	2026-04-28 17:48:52.815298+00	2026-04-28 17:48:52.817693+00	2026-04-28 17:48:52.815298+00	2026-04-28 17:48:52.817693+00
71d818b5-7e91-4cd1-b424-b64568b16032	8c46ae66-f491-4d42-9ec6-62a9800dff18	wego	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-04-28 17:48:52.819615+00	2026-04-28 17:48:52.829365+00	2026-04-28 17:48:52.819615+00	2026-04-28 17:48:52.829365+00
81779fab-370c-4a33-8c6a-afc4009da72c	8c46ae66-f491-4d42-9ec6-62a9800dff18	wego	success	CREATE_ADMIN	Admin user created	\N	2026-04-28 17:48:52.831027+00	2026-04-28 17:48:52.837155+00	2026-04-28 17:48:52.831027+00	2026-04-28 17:48:52.837155+00
82333bd2-a996-486c-90d1-77c7b22c1f64	8c46ae66-f491-4d42-9ec6-62a9800dff18	wego	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-04-28 17:48:52.83891+00	2026-04-28 17:48:52.84371+00	2026-04-28 17:48:52.83891+00	2026-04-28 17:48:52.84371+00
8cef04ef-7d6e-431c-88f2-1b21edbb467c	da3939fd-10b0-4256-9f14-ef0fe93cd020	atyaf	success	CREATE_TENANT_RECORD	Tenant record created	\N	2026-05-03 15:16:29.123979+00	2026-05-03 15:16:29.286867+00	2026-05-03 15:16:29.123979+00	2026-05-03 15:16:29.291256+00
710e5af4-3b40-4136-8aee-c8372b01a9cf	da3939fd-10b0-4256-9f14-ef0fe93cd020	atyaf	success	CREATE_TENANT_DATABASE	Database ready	\N	2026-05-03 15:16:29.297095+00	2026-05-03 15:16:29.560572+00	2026-05-03 15:16:29.297095+00	2026-05-03 15:16:29.560572+00
ea858106-d9b6-4006-a0e1-60719621b1a0	da3939fd-10b0-4256-9f14-ef0fe93cd020	atyaf	success	STORE_DATABASE_SECRET	Connection string stored	\N	2026-05-03 15:16:29.56281+00	2026-05-03 15:16:29.570347+00	2026-05-03 15:16:29.56281+00	2026-05-03 15:16:29.570347+00
62b17edf-78e6-4cd7-bad9-5abb9364af41	da3939fd-10b0-4256-9f14-ef0fe93cd020	atyaf	success	RUN_MIGRATIONS	Tenant migrations complete	\N	2026-05-03 15:16:29.576125+00	2026-05-03 15:16:30.308796+00	2026-05-03 15:16:29.576125+00	2026-05-03 15:16:30.308796+00
ea48220e-b8c8-49b0-8c1a-baf97290c6ff	da3939fd-10b0-4256-9f14-ef0fe93cd020	atyaf	success	SEED_DEFAULTS	Baseline data ready	\N	2026-05-03 15:16:30.336703+00	2026-05-03 15:16:30.363826+00	2026-05-03 15:16:30.336703+00	2026-05-03 15:16:30.363826+00
eac823e8-b3d9-4f43-915f-3a36264f32ae	da3939fd-10b0-4256-9f14-ef0fe93cd020	atyaf	success	CREATE_SUBSCRIPTION	Subscription created with locked pricing	\N	2026-05-03 15:16:30.366499+00	2026-05-03 15:16:30.374921+00	2026-05-03 15:16:30.366499+00	2026-05-03 15:16:30.374921+00
f0f5ec68-f5ba-4b21-bd33-90068a7dc1eb	da3939fd-10b0-4256-9f14-ef0fe93cd020	atyaf	success	CREATE_ADMIN	Admin user created	\N	2026-05-03 15:16:30.3768+00	2026-05-03 15:16:30.385917+00	2026-05-03 15:16:30.3768+00	2026-05-03 15:16:30.385917+00
bef15d1b-b3ec-4701-8140-97cb966d3087	da3939fd-10b0-4256-9f14-ef0fe93cd020	atyaf	success	SEND_WELCOME_EMAIL	Welcome email queued	\N	2026-05-03 15:16:30.387836+00	2026-05-03 15:16:30.392757+00	2026-05-03 15:16:30.387836+00	2026-05-03 15:16:30.392757+00
\.


--
-- Data for Name: rewards_config; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.rewards_config (id, daily_login, lesson_completion, quiz_pass, assignment_submission, credits_per_currency_unit, currency_code, updated_at) FROM stdin;
1	15	65	110	180	3200.00	USD	2026-03-01 14:07:08.508847+00
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.role_permissions (id, role_id, permission_id, created_at) FROM stdin;
7621efac-48d6-4524-8f60-351615f03a66	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	7f752c50-059d-4cfd-8eb1-8c790aaca302	2026-02-24 10:53:17.616275+00
9a03d8af-3cd9-44b2-90e3-d3d5f29c9f42	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	9a5a1c10-de46-49e8-aa0a-2fd461b0dd6b	2026-02-24 10:53:17.616275+00
99c26291-461d-4bac-91f5-a13c3fa41b89	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	3db7e408-5d98-4346-a0ae-0c6b3d7b6fb0	2026-02-24 10:53:17.616275+00
29ce7d32-0bac-4597-a52c-f1ed1bb1b844	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	b59636f5-2116-4eb2-ba3f-b746c21962b3	2026-02-24 10:53:17.616275+00
2e2f5779-1f7f-4c16-b80a-69d8aa74b526	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	77ba962c-2bb8-4df8-a10a-7ddd841e79fc	2026-02-24 10:53:17.616275+00
ca86edcb-ffc6-4517-828e-7472f37bc907	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	87f2997f-4b87-4da2-ab48-5a0e8292fe81	2026-02-24 10:53:17.616275+00
583a8143-9042-4835-bc93-1e15798804fe	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	337242c2-fc1d-4151-ab94-e721d79fd534	2026-02-24 10:53:17.616275+00
59509143-7dff-4cbd-bdb0-a7b99863748c	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	2d597e5d-cf68-40bb-906e-895e0cbc6134	2026-02-24 10:53:17.616275+00
3727145e-deda-4c78-9a75-553a1ee09252	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	df45cb76-e06f-4ac5-9506-43a1c4bd2891	2026-02-24 10:53:17.616275+00
5f93a63e-7fed-42a2-a648-aba547e24689	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	3a0dbd2c-fd52-4693-975e-fab3adf926e8	2026-02-24 10:53:17.616275+00
1adb66b8-9a1d-4b1f-bacb-32a9dc2a30d3	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	b8b1ac3e-5d04-40c5-a197-d9b3f67aef10	2026-02-24 10:53:17.616275+00
8806e07d-a9b7-4e31-ac15-dde71ce47a81	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	ecee6041-6dc3-420e-8355-db3b56fb5291	2026-02-24 10:53:17.616275+00
6b9cde1b-ce8e-4d10-8b68-b957bffd4de9	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	18dc2b23-8c09-47e9-b7ba-9c11a84b21f2	2026-02-24 10:53:17.616275+00
a066f94a-e82f-4ec1-95c6-d9ca7fa31253	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	52403608-f000-42b9-a1fb-365842c68298	2026-02-24 10:53:17.616275+00
0167d295-375b-4fb6-ba65-393030847856	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	f7fe1728-746a-4281-bfa9-4414fe6bd0ad	2026-02-24 10:53:17.616275+00
75404ce9-3adb-4435-a439-daa5ed62e1f6	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	e90b351c-1794-4aee-97ba-52ab60cb5002	2026-02-24 10:53:17.616275+00
541b9b35-c65a-4c0b-8116-8462a2e45ff0	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	e8b2badf-e8ff-4101-b3c1-eb35c3c13782	2026-02-24 10:53:17.616275+00
b29e3217-08a4-4bb8-8797-7ceec7f235b2	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	61c48f5b-3fad-437e-9a43-010af849f303	2026-02-24 10:53:17.616275+00
017e7a51-36d9-4d40-ac4d-64231e9c45e1	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	963ce048-4d49-47c9-afc5-1e4db8b0ae3f	2026-02-24 10:53:17.616275+00
83ed4798-fa24-41cb-bece-362936699ef5	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	a1e4051b-d023-4226-9528-8a24baaf7a88	2026-02-24 10:53:17.616275+00
3b00ac9d-9113-460e-8344-e8ffe6c71daf	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	57172c94-590a-4e2c-aa53-544cc8306294	2026-02-24 10:53:17.616275+00
cb791bb7-ceef-4aa3-95ba-2654658fd065	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	e685d3fb-869c-4e64-9067-6d4cf40fc889	2026-02-24 10:53:17.616275+00
46a2ac51-55a0-443e-9c5e-e35c4fd7aec7	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	8c0ae4da-a8bb-4a22-8e41-d1688619c479	2026-02-24 10:53:17.616275+00
4c7e3408-7b33-4745-9dd3-258ad352a039	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	b6a0ed9d-e06c-4f01-9f95-afbaf137e5f9	2026-02-24 10:53:17.616275+00
125871e4-fe08-406c-91e9-cbf667a8402f	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	86d378fe-e0bf-4e19-be40-7b55087badc2	2026-02-24 10:53:17.616275+00
5fafa648-0774-4ca2-803c-ba8bf38fec28	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	2b7e46ba-6a20-4d1e-8a88-6ef868bbd949	2026-02-24 10:53:17.616275+00
901f6f50-1ae1-40ae-bd52-3b8ed695647f	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	31325563-b2a7-4357-ae87-e8d8cc3c5ec8	2026-02-24 10:53:17.616275+00
c9fcc151-0aa6-45b1-af2b-0cebf8f95a2d	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	da2f42f7-f5a6-4429-830a-544808811573	2026-02-24 10:53:17.616275+00
529fea69-8d08-44e5-9215-e4bb4a9a7dba	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	8b9a2bf4-76b7-4c41-b9e7-c623f28a8785	2026-02-24 10:53:17.616275+00
5991c632-872c-4ab5-b05d-b82d8fb6181d	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	f652c528-702d-4acb-97ef-577cbda5ce49	2026-02-24 10:53:17.616275+00
8e1f129a-05c2-4120-9df3-afbddb71a7f7	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	c2c631f4-f63a-426d-a811-263a2750cafd	2026-02-24 10:53:17.616275+00
eac26799-90d8-4193-8041-2a706a013151	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	d1d72c98-5192-4e57-bbfb-364519a038e0	2026-02-24 10:53:17.616275+00
e1bd1522-d538-41bb-a5e8-c28435f183b1	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	644add1b-67b3-44bb-8b87-c318383e92a0	2026-02-24 10:53:17.616275+00
71b8da18-454d-4a41-9b91-0168c133412d	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	07b1a575-b02f-49a2-a662-786a382cada6	2026-02-24 10:53:17.616275+00
79184095-b534-4550-990a-e0f97d46401d	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	930ce114-43ce-4bd8-866c-86bbaed2e06c	2026-02-24 10:53:17.616275+00
b4cfcc13-7de4-4602-87a9-7f7003a417aa	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	e23c23a6-d1d6-4bb6-a30d-c5c35133484b	2026-02-24 10:53:17.616275+00
d01bbc3b-19aa-4344-bb18-4b831319c4a7	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	270e00b0-4660-4f18-92a7-7233e6855329	2026-02-24 10:53:17.616275+00
faa6619f-4168-448a-8d07-8e9cdde8876c	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	669815cb-2374-491d-a50e-7fd54f3ae9cd	2026-02-24 10:53:17.616275+00
fa84c0f4-2103-4724-a9d4-f50bd4c75cff	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	9d0cadaf-291c-4765-954b-d11d3ed8d515	2026-02-24 10:53:17.616275+00
5d310ae7-bc82-437f-ac47-637251e45177	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	23cf5a34-6109-4113-a93f-3277b8f8186f	2026-02-24 10:53:17.616275+00
fff415e8-0367-42e3-bbe2-a0a85b3899a9	d3f577a7-0f36-4962-8e3b-f7f79eff0b18	9ab92599-10b0-4f85-b1c0-e57fd9df5d3a	2026-02-24 10:53:17.616275+00
7428598a-713f-40f2-ace6-4f5a966f1e02	36be1e30-f400-4dcb-b693-94c53c148d0c	7f752c50-059d-4cfd-8eb1-8c790aaca302	2026-02-24 10:53:17.616275+00
d949ead3-dc3d-487b-90e1-657d1f0cf14e	36be1e30-f400-4dcb-b693-94c53c148d0c	9a5a1c10-de46-49e8-aa0a-2fd461b0dd6b	2026-02-24 10:53:17.616275+00
c2761b97-77f0-4989-b43b-74f78be03889	36be1e30-f400-4dcb-b693-94c53c148d0c	3db7e408-5d98-4346-a0ae-0c6b3d7b6fb0	2026-02-24 10:53:17.616275+00
0bcc89ba-115d-4bf7-b68c-97869a0d7544	36be1e30-f400-4dcb-b693-94c53c148d0c	77ba962c-2bb8-4df8-a10a-7ddd841e79fc	2026-02-24 10:53:17.616275+00
0ec3c387-4ab3-4816-abc3-eb47ef512339	36be1e30-f400-4dcb-b693-94c53c148d0c	2d597e5d-cf68-40bb-906e-895e0cbc6134	2026-02-24 10:53:17.616275+00
145b1a7c-454c-4361-bc15-6d765b1679e1	36be1e30-f400-4dcb-b693-94c53c148d0c	ecee6041-6dc3-420e-8355-db3b56fb5291	2026-02-24 10:53:17.616275+00
1e296e24-82e9-4ee3-a87e-1332d90aad70	36be1e30-f400-4dcb-b693-94c53c148d0c	18dc2b23-8c09-47e9-b7ba-9c11a84b21f2	2026-02-24 10:53:17.616275+00
ed8351e2-1d4c-480b-aadc-764c09fda9be	36be1e30-f400-4dcb-b693-94c53c148d0c	e8b2badf-e8ff-4101-b3c1-eb35c3c13782	2026-02-24 10:53:17.616275+00
a0526f3a-4de9-48ef-b66b-13923c3d0312	36be1e30-f400-4dcb-b693-94c53c148d0c	61c48f5b-3fad-437e-9a43-010af849f303	2026-02-24 10:53:17.616275+00
57bb663b-10a0-4f98-943c-1ed9f5e26e1d	36be1e30-f400-4dcb-b693-94c53c148d0c	963ce048-4d49-47c9-afc5-1e4db8b0ae3f	2026-02-24 10:53:17.616275+00
440d02e5-1df2-4948-9e2f-1c67390234db	36be1e30-f400-4dcb-b693-94c53c148d0c	a1e4051b-d023-4226-9528-8a24baaf7a88	2026-02-24 10:53:17.616275+00
f7423852-5287-4f13-99e3-4c79625ca2b0	36be1e30-f400-4dcb-b693-94c53c148d0c	57172c94-590a-4e2c-aa53-544cc8306294	2026-02-24 10:53:17.616275+00
17087c16-6e15-40e6-b488-7ace08aa982f	36be1e30-f400-4dcb-b693-94c53c148d0c	e685d3fb-869c-4e64-9067-6d4cf40fc889	2026-02-24 10:53:17.616275+00
2e8cf9ec-bcd1-4b27-b444-84d1b0254a86	36be1e30-f400-4dcb-b693-94c53c148d0c	8c0ae4da-a8bb-4a22-8e41-d1688619c479	2026-02-24 10:53:17.616275+00
7c94a4a0-4ce4-4e12-98d1-1f8f8298b720	36be1e30-f400-4dcb-b693-94c53c148d0c	b6a0ed9d-e06c-4f01-9f95-afbaf137e5f9	2026-02-24 10:53:17.616275+00
e1a3fae8-08aa-4652-ac9c-9a30b3e4dd50	36be1e30-f400-4dcb-b693-94c53c148d0c	86d378fe-e0bf-4e19-be40-7b55087badc2	2026-02-24 10:53:17.616275+00
742a561d-f8b7-40e5-91f7-f5befb239e1a	36be1e30-f400-4dcb-b693-94c53c148d0c	2b7e46ba-6a20-4d1e-8a88-6ef868bbd949	2026-02-24 10:53:17.616275+00
c2524f9c-1389-4f42-bf6b-ed68f1b61b42	36be1e30-f400-4dcb-b693-94c53c148d0c	31325563-b2a7-4357-ae87-e8d8cc3c5ec8	2026-02-24 10:53:17.616275+00
31252970-89cd-4242-9470-b97031a04952	36be1e30-f400-4dcb-b693-94c53c148d0c	da2f42f7-f5a6-4429-830a-544808811573	2026-02-24 10:53:17.616275+00
ea11b192-96e1-4ede-a591-3800397f26d2	36be1e30-f400-4dcb-b693-94c53c148d0c	f652c528-702d-4acb-97ef-577cbda5ce49	2026-02-24 10:53:17.616275+00
8d0ac8d3-f855-4387-91d2-386c91e309c2	36be1e30-f400-4dcb-b693-94c53c148d0c	c2c631f4-f63a-426d-a811-263a2750cafd	2026-02-24 10:53:17.616275+00
6495ce4b-21cd-400f-8a2f-15ada8a9a93a	242fe6e9-d837-4fc7-8a60-9dafdd43a633	9a5a1c10-de46-49e8-aa0a-2fd461b0dd6b	2026-02-24 10:53:17.616275+00
0d9ad709-f3a5-47c0-a80a-c54910ab6564	242fe6e9-d837-4fc7-8a60-9dafdd43a633	87f2997f-4b87-4da2-ab48-5a0e8292fe81	2026-02-24 10:53:17.616275+00
7e2d9ba3-7320-4be4-abd1-89d3e1c3ef69	242fe6e9-d837-4fc7-8a60-9dafdd43a633	2d597e5d-cf68-40bb-906e-895e0cbc6134	2026-02-24 10:53:17.616275+00
0bc1e0dc-4a75-4160-9823-5fcc8dd6b588	242fe6e9-d837-4fc7-8a60-9dafdd43a633	61c48f5b-3fad-437e-9a43-010af849f303	2026-02-24 10:53:17.616275+00
05fc7b39-f1f5-4581-93a0-83c67b0bb666	242fe6e9-d837-4fc7-8a60-9dafdd43a633	e685d3fb-869c-4e64-9067-6d4cf40fc889	2026-02-24 10:53:17.616275+00
6736fa8f-5afd-4fa9-8766-7ee15c574329	242fe6e9-d837-4fc7-8a60-9dafdd43a633	31325563-b2a7-4357-ae87-e8d8cc3c5ec8	2026-02-24 10:53:17.616275+00
f52c6336-a7de-44b4-b91f-4b4980038d06	29cee38e-b799-4322-bc5a-c482182b5cac	7f752c50-059d-4cfd-8eb1-8c790aaca302	2026-02-24 10:53:17.616275+00
a04c9913-ffe1-4655-8381-811e63c67d9e	29cee38e-b799-4322-bc5a-c482182b5cac	9a5a1c10-de46-49e8-aa0a-2fd461b0dd6b	2026-02-24 10:53:17.616275+00
195b2a98-fad1-4cfc-b4ff-59ec3cb3bbd4	29cee38e-b799-4322-bc5a-c482182b5cac	3db7e408-5d98-4346-a0ae-0c6b3d7b6fb0	2026-02-24 10:53:17.616275+00
2e71b92b-d460-4e9a-bcd1-c083e452f865	29cee38e-b799-4322-bc5a-c482182b5cac	2d597e5d-cf68-40bb-906e-895e0cbc6134	2026-02-24 10:53:17.616275+00
68265e0c-96c1-4b52-9a54-fba87b20bd97	29cee38e-b799-4322-bc5a-c482182b5cac	e8b2badf-e8ff-4101-b3c1-eb35c3c13782	2026-02-24 10:53:17.616275+00
5910cf7a-0470-4d34-a8a2-677f63306f95	29cee38e-b799-4322-bc5a-c482182b5cac	61c48f5b-3fad-437e-9a43-010af849f303	2026-02-24 10:53:17.616275+00
ae577cc5-b83e-4225-b0a3-1919dd4e2c7c	29cee38e-b799-4322-bc5a-c482182b5cac	963ce048-4d49-47c9-afc5-1e4db8b0ae3f	2026-02-24 10:53:17.616275+00
fd580fa8-4c03-4c5a-bc0d-20d3174cda0d	29cee38e-b799-4322-bc5a-c482182b5cac	a1e4051b-d023-4226-9528-8a24baaf7a88	2026-02-24 10:53:17.616275+00
94a2ff6f-036d-4877-bdc7-1bb20e5794cc	29cee38e-b799-4322-bc5a-c482182b5cac	2b7e46ba-6a20-4d1e-8a88-6ef868bbd949	2026-02-24 10:53:17.616275+00
81762123-6129-4581-be23-77c06944ae6a	29cee38e-b799-4322-bc5a-c482182b5cac	31325563-b2a7-4357-ae87-e8d8cc3c5ec8	2026-02-24 10:53:17.616275+00
993eefac-e462-4947-97a8-7f088a5a7868	29cee38e-b799-4322-bc5a-c482182b5cac	da2f42f7-f5a6-4429-830a-544808811573	2026-02-24 10:53:17.616275+00
4b42ae52-0dbf-4c8f-8f5d-470cf481790b	29cee38e-b799-4322-bc5a-c482182b5cac	8b9a2bf4-76b7-4c41-b9e7-c623f28a8785	2026-02-24 10:53:17.616275+00
6f3b24e9-814c-47b7-af23-c88f39b27b04	29cee38e-b799-4322-bc5a-c482182b5cac	f652c528-702d-4acb-97ef-577cbda5ce49	2026-02-24 10:53:17.616275+00
09a22d6b-db3a-4dc3-bcde-1994b85e203f	aede0e1a-74a5-4127-bf00-4d6fb932f982	9a5a1c10-de46-49e8-aa0a-2fd461b0dd6b	2026-02-24 10:53:17.616275+00
fb069973-ef9f-44ba-a53c-29d15a0fe69c	aede0e1a-74a5-4127-bf00-4d6fb932f982	2d597e5d-cf68-40bb-906e-895e0cbc6134	2026-02-24 10:53:17.616275+00
c64b24b7-ec45-47c3-aadd-52a43c439b81	aede0e1a-74a5-4127-bf00-4d6fb932f982	ecee6041-6dc3-420e-8355-db3b56fb5291	2026-02-24 10:53:17.616275+00
5db665eb-0117-44c3-b7e8-5f9505e52528	aede0e1a-74a5-4127-bf00-4d6fb932f982	18dc2b23-8c09-47e9-b7ba-9c11a84b21f2	2026-02-24 10:53:17.616275+00
29787e0a-2f68-42f6-a4aa-2b86f2be2241	aede0e1a-74a5-4127-bf00-4d6fb932f982	52403608-f000-42b9-a1fb-365842c68298	2026-02-24 10:53:17.616275+00
74bad899-aafc-42fe-a964-ab0b60df34e2	aede0e1a-74a5-4127-bf00-4d6fb932f982	61c48f5b-3fad-437e-9a43-010af849f303	2026-02-24 10:53:17.616275+00
fdb2d3e0-03ec-4934-ba95-0ca6f3a40d98	aede0e1a-74a5-4127-bf00-4d6fb932f982	e685d3fb-869c-4e64-9067-6d4cf40fc889	2026-02-24 10:53:17.616275+00
2c0b8ad5-7a6e-4926-9476-6c9fa0eb2033	aede0e1a-74a5-4127-bf00-4d6fb932f982	86d378fe-e0bf-4e19-be40-7b55087badc2	2026-02-24 10:53:17.616275+00
680e6782-cd35-4531-aa4f-d30ff746d293	aede0e1a-74a5-4127-bf00-4d6fb932f982	c2c631f4-f63a-426d-a811-263a2750cafd	2026-02-24 10:53:17.616275+00
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.roles (id, name, display_name, description, is_system, is_active, created_at, updated_at) FROM stdin;
d3f577a7-0f36-4962-8e3b-f7f79eff0b18	ADMIN	Administrator	Full system access with all permissions	t	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
36be1e30-f400-4dcb-b693-94c53c148d0c	INSTRUCTOR	Instructor	Can create and manage courses, lessons, and grade assignments	t	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
242fe6e9-d837-4fc7-8a60-9dafdd43a633	STUDENT	Student	Can enroll in courses and view content	t	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
29cee38e-b799-4322-bc5a-c482182b5cac	CONTENT_CREATOR	Content Creator	Can create and edit courses and blog posts	t	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
aede0e1a-74a5-4127-bf00-4d6fb932f982	TEACHING_ASSISTANT	Teaching Assistant	Can help grade assignments and manage enrollments	t	t	2026-02-24 10:53:17.616275+00	2026-02-24 10:53:17.616275+00
5edfc5a3-e27f-4008-8453-33def490b8fb	MEMBER	Member	Login-enabled member with learner dashboard access	t	t	2026-03-26 10:17:46.944426+00	2026-03-26 10:17:46.944426+00
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.schema_migrations (scope, filename, applied_at) FROM stdin;
tenant	000_enable_extensions.sql	2026-02-24 10:53:17.22719+00
tenant	001_base_schema.sql	2026-02-24 10:53:17.260424+00
tenant	002_create_course_payments.sql	2026-02-24 10:53:17.337623+00
tenant	003_create_instructor_payouts.sql	2026-02-24 10:53:17.372931+00
tenant	004_add_course_category.sql	2026-02-24 10:53:17.410767+00
tenant	005_add_blog_category.sql	2026-02-24 10:53:17.443561+00
tenant	006_add_blog_media_fields.sql	2026-02-24 10:53:17.474734+00
tenant	007_add_blog_slug.sql	2026-02-24 10:53:17.506031+00
tenant	014_add_stripe_fields_to_course_payments.sql	2026-02-24 10:53:17.543932+00
tenant	015_add_payment_refunds_table.sql	2026-02-24 10:53:17.57779+00
tenant	015_create_rbac_tables.sql	2026-02-24 10:53:17.616275+00
tenant	016_add_password_hash.sql	2026-02-24 10:53:17.671207+00
tenant	017_add_created_by_to_courses.sql	2026-02-24 10:53:17.703474+00
tenant	018_add_course_additional_fields.sql	2026-02-24 10:53:17.736911+00
tenant	019_create_ai_config.sql	2026-02-24 10:53:17.769814+00
tenant	020_create_seo_settings.sql	2026-02-24 10:53:17.834364+00
tenant	022_create_course_categories.sql	2026-02-24 10:53:17.870278+00
tenant	023_create_seo_overrides.sql	2026-02-24 10:53:17.903169+00
tenant	024_fix_messaging_schema.sql	2026-02-24 10:53:17.93841+00
tenant	025_fix_updated_at_trigger_function.sql	2026-02-24 10:53:18.012063+00
tenant	026_add_stripe_webhook_secret.sql	2026-02-24 10:53:18.045179+00
tenant	027_add_password_reset_tokens.sql	2026-03-05 12:20:10.966887+00
central	000_enable_extensions.sql	2026-03-09 08:56:54.624997+00
central	001_create_tenants.sql	2026-03-09 08:56:54.647985+00
central	002_create_tenant_admins.sql	2026-03-09 08:56:54.676514+00
central	003_create_provisioning_logs.sql	2026-03-09 08:56:54.697924+00
central	004_create_subscriptions.sql	2026-03-09 08:56:54.718182+00
central	005_create_payment_transactions.sql	2026-03-09 08:56:54.739473+00
central	006_create_platform_users.sql	2026-03-09 08:56:54.759148+00
central	006_create_tenant_user_links.sql	2026-03-09 08:56:54.779875+00
central	029_create_email_settings.sql	2026-03-09 08:57:12.982486+00
tenant	028_create_ads_marketplace.sql	2026-03-16 12:44:55.125429+00
tenant	029_add_ads_announcements.sql	2026-03-17 09:58:46.966342+00
tenant	030_add_ads_announcements_i18n.sql	2026-03-17 10:19:50.184794+00
tenant	031_create_freelancer_and_membership_submissions.sql	2026-03-26 10:17:46.944426+00
tenant	032_add_national_id_to_users.sql	2026-04-27 09:09:22.264135+00
central	032_add_public_user_id_to_users.sql	2026-04-27 11:09:25.888+00
tenant	033_add_public_user_id_to_users.sql	2026-04-27 11:28:41.17617+00
tenant	034_add_phone_country_code_to_users.sql	2026-04-28 08:43:25.779958+00
tenant	035_add_gender_to_users.sql	2026-04-28 10:32:53.713797+00
tenant	036_add_follow_up_status_to_users.sql	2026-04-28 10:52:33.981976+00
\.


--
-- Data for Name: seo_overrides; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.seo_overrides (id, content_type, content_id, title_en, title_ar, description_en, description_ar, keywords_en, keywords_ar, canonical_url, robots, indexable, og_title_en, og_title_ar, og_description_en, og_description_ar, og_image_url, og_type, og_site_name, twitter_card, twitter_title_en, twitter_title_ar, twitter_description_en, twitter_description_ar, twitter_image_url, jsonld_en, jsonld_ar, locale, locale_alternate, sitemap_priority, sitemap_changefreq, created_at, updated_at, created_by, updated_by) FROM stdin;
\.


--
-- Data for Name: seo_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.seo_settings (id, page_path, title_en, title_ar, description_en, description_ar, keywords_en, keywords_ar, canonical_url, robots, indexable, og_title_en, og_title_ar, og_description_en, og_description_ar, og_image_url, og_type, og_site_name, twitter_card, twitter_title_en, twitter_title_ar, twitter_description_en, twitter_description_ar, twitter_image_url, jsonld_en, jsonld_ar, locale, locale_alternate, sitemap_priority, sitemap_changefreq, created_at, updated_at, created_by, updated_by) FROM stdin;
2c4f0b13-3ab0-43de-bf1a-7775464f8a50	/dashboard	Dashboard	لوحة التحكم	Access your learning dashboard	الوصول إلى لوحة التحكم التعليمية	dashboard, learning, courses	لوحة التحكم, تعلم, دورات	\N	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-02-24 10:53:17.834364+00	2026-02-24 10:53:17.834364+00	\N	\N
57a485a7-7ce2-4632-87c5-f3bf379f9f48	/courses	Courses	الدورات	Browse available courses	تصفح الدورات المتاحة	courses, learning, education	دورات, تعلم, تعليم	\N	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-02-24 10:53:17.834364+00	2026-02-24 10:53:17.834364+00	\N	\N
692c2c53-b9ef-4adf-a4c9-85d8c187a91e	/blog	Blog	المدونة	Read our latest articles	اقرأ أحدث مقالاتنا	blog, articles, news	مدونة, مقالات, أخبار	\N	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-02-24 10:53:17.834364+00	2026-02-24 10:53:17.834364+00	\N	\N
2c9dffc7-ae7a-4f7d-9bb5-e1938855883d	/	Home	الصفحة الرئيسية	Welcome to our learning platform	مرحباً بك في منصتنا التعليمية	home, education, learning	الصفحة الرئيسية, تعليم, تعلم	\N	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-02-24 10:53:17.834364+00	2026-02-24 10:53:17.834364+00	\N	\N
\.


--
-- Data for Name: static_pages; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.static_pages (slug, title, content, updated_by, updated_at) FROM stdin;
services	Services	{\n  "sectionLabel": "",\n  "sectionHeading": "",\n  "cards": [\n    {\n      "title": "test",\n      "description": "Upskill your workforce with tailored programs."\n    },\n    {\n      "title": "K-12 Education",\n      "description": "Comprehensive curriculum for schools."\n    },\n    {\n      "title": "Certification",\n      "description": "Industry-recognized certificates upon completion."\n    },\n    {\n      "title": "Consulting",\n      "description": "Educational strategy and curriculum design."\n    }\n  ]\n}	ecfbd4c3-2eee-4237-883f-419f5d1558e3	2026-03-08 12:16:46.710559+00
about-us	About Us		ecfbd4c3-2eee-4237-883f-419f5d1558e3	2026-03-08 12:17:14.350384+00
contact-us	Contact Us	contact us at 0000	ecfbd4c3-2eee-4237-883f-419f5d1558e3	2026-03-08 12:17:26.31922+00
home	Home	{\n  "whyChooseLabel": "Why Choose Us",\n  "whyChooseHeading": "",\n  "whyChooseSubtitle": "",\n  "whyChooseCards": [\n    {\n      "title": "منصة متكاملة",\n      "description": "كل ما تحتاجه لإدارة عملية التعلم في مكان واحد، من الدورات التدريبية إلى التقييمات والمتابعة."\n    },\n    {\n      "title": "أطلق أكاديميتك الخاصة",\n      "description": "احصل على نطاق فرعي خاص بك وقم ببناء أكاديميتك بدون أي متاعب تقنية."\n    },\n    {\n      "title": "إدارة المستخدمين بسهولة",\n      "description": "تحكم كامل وسهل في المستخدمين والصلاحيات والاشتراكات."\n    },\n    {\n      "title": "اختبارات وواجبات ذكية",\n      "description": "أنشئ اختبارات وواجبات مع تصحيح تلقائي أو يدوي."\n    },\n    {\n      "title": "دعم مدعوم بالذكاء الاصطناعي",\n      "description": "تجربة تعليمية متقدمة تستخدم أدوات الذكاء الاصطناعي لتحسين التعلم والمتابعة."\n    },\n    {\n      "title": "مصمم وفقًا للمقياس",\n      "description": "صُممت للأفراد والمؤسسات، مع إمكانية التوسع بسهولة في أي وقت."\n    }\n  ],\n  "footer": {\n    "description": "",\n    "contactEmail": "111@email.com",\n    "contactPhone": "123456",\n    "copyrightText": "",\n    "socialLinks": [\n      {\n        "label": "Facebook",\n        "url": "url facebook"\n      },\n      {\n        "label": "Instagram",\n        "url": "url insta"\n      },\n      {\n        "label": "LinkedIn",\n        "url": "LinkedIn"\n      },\n      {\n        "label": "YouTube",\n        "url": "YouTube"\n      }\n    ]\n  }\n}	ecfbd4c3-2eee-4237-883f-419f5d1558e3	2026-03-25 14:09:44.329555+00
\.


--
-- Data for Name: subscription_plan_prices; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_plan_prices (id, plan_id, billing_cycle, amount, currency, valid_from, valid_to, is_active, created_at, updated_at) FROM stdin;
09d9ec24-f79a-4a87-b2e5-517240b17320	0816aad5-9b81-4dac-9841-cb16dc0275df	monthly	29.00	USD	2026-02-24 10:53:16.619341+00	\N	t	2026-02-24 10:53:16.619341+00	2026-02-24 10:53:16.619341+00
89eb82be-8699-4ab6-bb10-d90028405b93	0816aad5-9b81-4dac-9841-cb16dc0275df	yearly	290.00	USD	2026-02-24 10:53:16.619341+00	\N	t	2026-02-24 10:53:16.619341+00	2026-02-24 10:53:16.619341+00
fa87eb17-5ced-4c53-9047-8e98871eca8e	4b2f755b-8582-4a6f-b41e-4ce8ec475ecd	monthly	99.00	USD	2026-02-24 10:53:16.619341+00	\N	t	2026-02-24 10:53:16.619341+00	2026-02-24 10:53:16.619341+00
a6352b4e-f49f-4e98-ab75-06121adb1a15	4b2f755b-8582-4a6f-b41e-4ce8ec475ecd	yearly	990.00	USD	2026-02-24 10:53:16.619341+00	\N	t	2026-02-24 10:53:16.619341+00	2026-02-24 10:53:16.619341+00
3aa7a166-aef8-4663-9ac4-1cbdf61285fa	c7c28f82-9922-4041-bacb-a38625b6e2e5	monthly	299.00	USD	2026-02-24 10:53:16.619341+00	\N	t	2026-02-24 10:53:16.619341+00	2026-02-24 10:53:16.619341+00
5c482df0-efea-4bf9-b149-0857edb4c734	c7c28f82-9922-4041-bacb-a38625b6e2e5	yearly	2990.00	USD	2026-02-24 10:53:16.619341+00	\N	t	2026-02-24 10:53:16.619341+00	2026-02-24 10:53:16.619341+00
\.


--
-- Data for Name: subscription_plans; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_plans (id, code, name, display_name, description, is_active, created_at, updated_at) FROM stdin;
0816aad5-9b81-4dac-9841-cb16dc0275df	basic	Basic Plan	Basic	\N	t	2026-02-24 10:53:16.536424+00	2026-02-24 10:53:16.536424+00
4b2f755b-8582-4a6f-b41e-4ce8ec475ecd	pro	Professional Plan	Pro	\N	t	2026-02-24 10:53:16.536424+00	2026-02-24 10:53:16.536424+00
c7c28f82-9922-4041-bacb-a38625b6e2e5	enterprise	Enterprise Plan	Enterprise	\N	t	2026-02-24 10:53:16.536424+00	2026-02-24 10:53:16.536424+00
\.


--
-- Data for Name: subscription_refunds; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscription_refunds (id, payment_transaction_id, tenant_id, refund_id, stripe_refund_id, amount, currency, status, reason, refunded_by, refunded_by_name, refunded_by_email, stripe_receipt_number, metadata, refunded_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: subscriptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.subscriptions (id, tenant_id, plan, status, price_monthly, currency, billing_cycle, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at, locked_amount, locked_currency, plan_id, stripe_subscription_id, price_snapshot) FROM stdin;
3425b76d-7471-4ae0-b602-0bc267093c53	77ec1d51-2c26-47c7-b917-589cf643588e	basic	active	29.00	USD	monthly	2026-03-04 10:46:15.25261+00	2026-04-04 10:46:15.25261+00	f	2026-03-04 10:46:15.25261+00	2026-03-04 10:46:15.25261+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-03-04T10:46:15.25261+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
ecfbff5f-ad56-4387-8285-ff9eea04a1ab	3d2a7d54-eef4-4e2a-bc35-531dac0f2c39	basic	active	29.00	USD	monthly	2026-03-04 13:34:05.346729+00	2026-04-04 13:34:05.346729+00	f	2026-03-04 13:34:05.346729+00	2026-03-04 13:34:05.346729+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-03-04T13:34:05.346729+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
7d92cb95-f651-4a9f-a966-2f22ee942ceb	6a3960fb-4bee-435d-8c87-002eeaa5cfc3	basic	active	29.00	USD	monthly	2026-03-04 14:03:15.757063+00	2026-04-04 14:03:15.757063+00	f	2026-03-04 14:03:15.757063+00	2026-03-04 14:03:15.757063+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-03-04T14:03:15.757063+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
7a8419ab-b22b-4fde-8027-754ae078f973	b12cea5c-4611-4484-a7e1-97440c51eb68	basic	active	29.00	USD	monthly	2026-03-04 14:13:44.97731+00	2026-04-04 14:13:44.97731+00	f	2026-03-04 14:13:44.97731+00	2026-03-04 14:13:44.97731+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-03-04T14:13:44.97731+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
16d7fdb3-cc05-4f2d-b275-566df8e46463	a4f738cf-78ff-4291-9a36-ed20adff3934	basic	active	29.00	USD	monthly	2026-03-04 14:14:46.672584+00	2026-04-04 14:14:46.672584+00	f	2026-03-04 14:14:46.672584+00	2026-03-04 14:14:46.672584+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-03-04T14:14:46.672584+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
3f0a82ac-c2a5-4249-85a1-14d3637b55cc	4ead1eb0-8dab-419d-953e-76e0142d80a5	basic	active	29.00	USD	monthly	2026-03-04 14:21:34.334455+00	2026-04-04 14:21:34.334455+00	f	2026-03-04 14:21:34.334455+00	2026-03-04 14:21:34.334455+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-03-04T14:21:34.334455+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
af2a58eb-4c08-4b41-bc6d-1fabbdc86284	a19d448c-0018-466f-8f35-0b8eaf01e2f9	basic	active	29.00	USD	monthly	2026-03-04 14:48:11.2383+00	2026-04-04 14:48:11.2383+00	f	2026-03-04 14:48:11.2383+00	2026-03-04 14:48:11.2383+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-03-04T14:48:11.2383+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
f6eddd70-9e0f-4da0-ad16-ffca5a1c692f	74bf2ead-ebc3-4061-a988-778c2a16ff9e	basic	active	29.00	USD	monthly	2026-03-04 15:00:40.241914+00	2026-04-04 15:00:40.241914+00	f	2026-03-04 15:00:40.241914+00	2026-03-04 15:00:40.241914+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-03-04T15:00:40.241914+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
1f2ace34-6f9a-423f-aa61-5e3bf18539f8	60a51aeb-86f2-442b-81e0-d2d07821af46	basic	active	29.00	USD	monthly	2026-03-04 15:12:45.946528+00	2026-04-04 15:12:45.946528+00	f	2026-03-04 15:12:45.946528+00	2026-03-04 15:12:45.946528+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-03-04T15:12:45.946528+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
3411e206-ba6d-440b-9e25-1964523072b5	22ab2fce-c868-4648-8fdf-8eb629f9a494	basic	active	29.00	USD	monthly	2026-03-05 09:10:33.118688+00	2026-04-05 09:10:33.118688+00	f	2026-03-05 09:10:33.118688+00	2026-03-05 09:10:33.118688+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-03-05T09:10:33.118688+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
a074977c-719e-43e1-9e97-16b411ed44c1	7b05964c-da31-4212-9471-b9384d575715	basic	active	29.00	USD	monthly	2026-03-08 13:07:13.694203+00	2026-04-08 13:07:13.694203+00	f	2026-03-08 13:07:13.694203+00	2026-03-08 13:07:13.694203+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-03-08T13:07:13.694203+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
c5925d8f-5cbc-4b2e-a575-9ea74c7afe66	ac199157-3bc3-4792-9f84-4b6b80026d19	basic	active	29.00	USD	monthly	2026-03-10 12:07:04.954585+00	2026-04-10 12:07:04.954585+00	f	2026-03-10 12:07:04.954585+00	2026-03-10 12:07:04.954585+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-03-10T12:07:04.954585+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
943a51ae-2cf7-4ec4-9ea8-4183dcd7a1ec	6307963b-7063-4202-80c3-0200b33218c6	basic	active	29.00	USD	monthly	2026-03-10 12:20:42.320965+00	2026-04-10 12:20:42.320965+00	f	2026-03-10 12:20:42.320965+00	2026-03-10 12:20:42.320965+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-03-10T12:20:42.320965+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
ace2ef98-731a-4eae-893d-ce31ca25892e	1da3fada-f597-4a2a-86c1-41cbb19dd456	basic	active	29.00	USD	monthly	2026-03-10 12:25:59.744446+00	2026-04-10 12:25:59.744446+00	f	2026-03-10 12:25:59.744446+00	2026-03-10 12:25:59.744446+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-03-10T12:25:59.744446+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
0d941cc9-430e-42aa-92ef-eebe894a64a7	fd0698bf-7c64-4cc6-939f-216e24111483	basic	active	29.00	USD	monthly	2026-04-25 18:04:08.296587+00	2026-05-25 18:04:08.296587+00	f	2026-04-25 18:04:08.296587+00	2026-04-25 18:04:08.296587+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-04-25T18:04:08.296587+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
7e8d1475-f5e8-4146-ae5d-4b8de139a5e1	67cc3fea-70d6-4c48-87c4-93fee941cc53	basic	active	29.00	USD	monthly	2026-04-26 07:29:45.578379+00	2026-05-26 07:29:45.578379+00	f	2026-04-26 07:29:45.578379+00	2026-04-26 07:29:45.578379+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-04-26T07:29:45.578379+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
ad721b55-5791-47d2-a597-68423dfa8cbb	b524ae48-9a4e-467f-bdcf-1a6ee78d5c3c	basic	active	29.00	USD	monthly	2026-04-27 05:30:53.613706+00	2026-05-27 05:30:53.613706+00	f	2026-04-27 05:30:53.613706+00	2026-04-27 05:30:53.613706+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-04-27T05:30:53.613706+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
ad1954c3-b7e9-43f3-bb19-18f853864e15	8c46ae66-f491-4d42-9ec6-62a9800dff18	basic	active	29.00	USD	monthly	2026-04-28 17:48:52.826322+00	2026-05-28 17:48:52.826322+00	f	2026-04-28 17:48:52.826322+00	2026-04-28 17:48:52.826322+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-04-28T17:48:52.826322+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
0ae39fdf-06f0-4936-a8e1-415efe28e29c	da3939fd-10b0-4256-9f14-ef0fe93cd020	basic	active	29.00	USD	monthly	2026-05-03 15:16:30.371885+00	2026-06-03 15:16:30.371885+00	f	2026-05-03 15:16:30.371885+00	2026-05-03 15:16:30.371885+00	29.00	USD	0816aad5-9b81-4dac-9841-cb16dc0275df	\N	{"plan_id": "0816aad5-9b81-4dac-9841-cb16dc0275df", "plan_code": "basic", "snapshot_at": "2026-05-03T15:16:30.371885+00:00", "billing_cycle": "monthly", "locked_amount": 29.00, "locked_currency": "USD", "stripe_subscription_id": null}
\.


--
-- Data for Name: system_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.system_settings (id, key, value, value_type, category, description, is_encrypted, is_public, validation_rules, default_value, created_at, updated_at, created_by, updated_by) FROM stdin;
51dde6e5-78d9-4e05-85b7-b95a2a760800	platform.name	\N	string	general	Platform name displayed across the application	f	t	\N	LMS Platform	2026-02-24 10:53:16.430509+00	2026-02-24 10:53:16.430509+00	\N	\N
e83c1558-8c3a-419b-8a16-ec948626c8e8	platform.support_email	\N	string	general	Support email address for user inquiries	f	t	\N	support@example.com	2026-02-24 10:53:16.430509+00	2026-02-24 10:53:16.430509+00	\N	\N
c257cfde-6ad0-4923-b3e2-e96bfa14d2b4	features.ai_course_generation	\N	boolean	features	Enable AI-powered course generation	f	f	\N	false	2026-02-24 10:53:16.430509+00	2026-02-24 10:53:16.430509+00	\N	\N
9757c7ee-b34d-4c42-9e79-21d2cc1df638	features.multi_currency	\N	boolean	features	Enable multi-currency support	f	f	\N	false	2026-02-24 10:53:16.430509+00	2026-02-24 10:53:16.430509+00	\N	\N
1423edf4-6567-4db3-8239-502238a46895	security.session_timeout_minutes	\N	number	security	Session timeout in minutes	f	f	\N	60	2026-02-24 10:53:16.430509+00	2026-02-24 10:53:16.430509+00	\N	\N
60059f34-8171-422f-a44d-ff540f07dc2f	security.max_login_attempts	\N	number	security	Maximum login attempts before account lock	f	f	\N	5	2026-02-24 10:53:16.430509+00	2026-02-24 10:53:16.430509+00	\N	\N
4b193a53-b489-47d3-a111-429ddfcf9a1b	email.from_address	\N	string	email	Default sender email address	f	f	\N	noreply@example.com	2026-02-24 10:53:16.430509+00	2026-02-24 10:53:16.430509+00	\N	\N
be2a8bfc-323c-41f8-b6c6-ebb504c98448	payment.currency	\N	string	payment	Default currency for payments	f	t	\N	USD	2026-02-24 10:53:16.430509+00	2026-02-24 10:53:16.430509+00	\N	\N
51ccf76f-86c7-4f68-a3ec-62fda6f7b591	audit.retention_days	\N	number	audit	Number of days to retain audit logs	f	f	\N	365	2026-02-24 10:53:16.430509+00	2026-02-24 10:53:16.430509+00	\N	\N
a3180429-fe88-4d67-9991-c96f46171b18	maintenance.mode	\N	boolean	maintenance	Enable maintenance mode	f	t	\N	false	2026-02-24 10:53:16.430509+00	2026-02-24 10:53:16.430509+00	\N	\N
0cac4a48-02d2-4c37-8c77-2732a856e2b6	maintenance.message	\N	string	maintenance	Maintenance mode message	f	t	\N	We are currently performing maintenance. Please check back soon.	2026-02-24 10:53:16.430509+00	2026-02-24 10:53:16.430509+00	\N	\N
34687cf9-518b-4801-b03c-53bf90daa951	platform.appearance	{"branding":{"primaryColor":"#e82c2c","secondaryColor":"#e0e2e6","accentColor":"#f97316","logoUrl":"/beta-logo.png","faviconUrl":"/beta-logo.png","footerText":"Empowering the next generation of learners with AI-driven education tools.1","heroTitleLeading":"تعرف على","heroTitleHighlight":null,"heroSubtitle":null,"heroBadge":null,"primaryCtaLabel":null,"secondaryCtaLabel":null,"pricingCtaLabel":null,"heroBackgroundColor":"#08061e","heroBackgroundMode":"video","heroBackgroundImageUrl":"/uploads/blog-images/image-1775980532736-e7675586-4830-4b0f-b84b-02315842c719.jpg","heroBackgroundVideoUrl":"/uploads/blog-videos/video-1774446689215-9b288f19-9eac-4e6e-ba6c-54df16ed0471.mp4","footerBackgroundColor":"#3a1818","announcementBarColor":"#8c3b3b","heroMediaGallery":[{"id":"media_fallback_video_cdlja","url":"/uploads/blog-videos/video-1774446689215-9b288f19-9eac-4e6e-ba6c-54df16ed0471.mp4","mediaType":"video","order":0},{"id":"media_1774528614834_8t6jh4","url":"/uploads/blog-images/image-1775980532736-e7675586-4830-4b0f-b84b-02315842c719.jpg","mediaType":"image","order":1}]},"pricing":{"headline":"Flexible pricing for every academy","subheading":"Scale confidently with transparent plans tailored to your growth.","ctaLabel":"Get started","plans":[{"id":"starter","title":"Starter","price":"$29/mo","description":"Launch-ready essentials for new academies.","highlight":false,"features":["Up to 100 students","Core LMS modules","Email support"]},{"id":"growth","title":"Growth","price":"$99/mo","description":"Automation, live classes, and analytics.","highlight":true,"features":["Live classes","Automation toolkit","Priority support"]},{"id":"enterprise","title":"Enterprise","price":"Custom","description":"Tailored infrastructure and white-glove onboarding.","highlight":false,"features":["Unlimited students","Dedicated success manager","Custom SLAs"]}]},"appearanceMeta":{"updatedAt":"2026-04-12T07:55:48.376Z","updatedBy":"aa0afda3-5d57-4d3d-bcbc-2d193e4a4d86"}}	json	general	Central domain appearance settings	f	t	\N	\N	2026-03-08 13:49:16.574559+00	2026-04-12 07:55:48.376635+00	\N	\N
\.


--
-- Data for Name: tenant_admins; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tenant_admins (id, tenant_id, email, password, first_name, last_name, phone, is_primary, created_at, updated_at, password_hash, reset_token_hash, reset_token_expires) FROM stdin;
501cbf93-93e9-489d-a1ff-d10f4393d08c	77ec1d51-2c26-47c7-b917-589cf643588e	reham@reham.com	\N	re	re	\N	t	2026-03-04 10:46:13.13754+00	2026-03-04 10:46:13.13754+00	$2b$10$UrZQoxxTsD3bWggQ/cPv6O9QhpXRHxERc4GP130N9buTGAFUxEvV6	\N	\N
fd299d66-4a49-4e56-86a3-ba018d0447aa	3d2a7d54-eef4-4e2a-bc35-531dac0f2c39	xyz@xyz.com	\N	karim	wajih	\N	t	2026-03-04 13:34:03.718514+00	2026-03-04 13:34:03.718514+00	$2b$10$9XacteNNL2IeZ6d7yw0jYedZ/6cAURizyRasG3RPrq1WhuosfCHsi	\N	\N
2a87a5cf-4eb0-4a7d-b2c0-8f87b881a950	6a3960fb-4bee-435d-8c87-002eeaa5cfc3	123@admin.com	\N	11	11	\N	t	2026-03-04 14:03:14.221659+00	2026-03-04 14:03:14.221659+00	$2b$10$EwzB3mJIffkSiKHF/4qsDuNS1qPAnNalsoccwKg3byZxhNawZFotG	\N	\N
4a0f5cb5-ca5d-422a-acd8-be3c268e211e	b12cea5c-4611-4484-a7e1-97440c51eb68	reham@admin.com	\N	reham	ad	\N	t	2026-03-04 14:13:43.414357+00	2026-03-04 14:13:43.414357+00	$2b$10$ZGxOF.wSeG2XnfsTDIM5IOKN2Ljq5eXbYk5dMgZbVS1Y038/EI31y	\N	\N
bc8fa1f4-7be8-4e29-be2d-20fa1f50ea57	a4f738cf-78ff-4291-9a36-ed20adff3934	yoyo@yoyo.com	\N	reha	yo	\N	t	2026-03-04 14:14:45.640506+00	2026-03-04 14:14:45.640506+00	$2b$10$qZ9r6npWJHYtqM3/zqVwdebsbyZR9oTlP.ABqbbAXNMf.LRQmfTkS	\N	\N
6e11d0f7-8e9c-4142-98fe-7f889135571a	4ead1eb0-8dab-419d-953e-76e0142d80a5	reham@tete.com	\N	123456	12	\N	t	2026-03-04 14:21:33.15412+00	2026-03-04 14:21:33.15412+00	$2b$10$kq0xR/kspd7v1YGkOIM48Oyx9tVkLdaKz0/oanrAvjsMVuq0l/oH2	\N	\N
d7e2a8a9-caea-4870-8e94-058d0b70482d	a19d448c-0018-466f-8f35-0b8eaf01e2f9	lara@lara.com	\N	lara	karim	\N	t	2026-03-04 14:48:10.513136+00	2026-03-04 14:48:10.513136+00	$2b$10$xsd24unoO7IwIRkpleSWFeTEV5NEj3YHWS1nD0hq2S9tfbSGukfcC	\N	\N
60f97ef7-386f-4573-a655-e472f7b53323	60a51aeb-86f2-442b-81e0-d2d07821af46	Test@admin.com	\N	Re	Er	\N	t	2026-03-04 15:12:44.853293+00	2026-03-04 15:12:44.853293+00	$2b$10$DiIgaMJ7Fpfp0uDEJ6XktO4b7/39VP6366zqMWFOIsJhR9Fhr2qGO	\N	\N
0929b4b6-2ebb-49ab-90fc-85bfe72b0bb9	22ab2fce-c868-4648-8fdf-8eb629f9a494	admin@reham.com	\N	reham	1	\N	t	2026-03-05 09:10:31.932038+00	2026-03-05 09:10:31.932038+00	$2b$10$BYBzP4U2Nk1ZqRitXdg9ROS4x6KX.2xexuwjci9amsjVNxLBbD80y	\N	\N
9baa5aa2-7b2e-4166-85ba-37433561fc90	7b05964c-da31-4212-9471-b9384d575715	admin@sasha.com	\N	admin	sasha	\N	t	2026-03-08 13:07:12.112421+00	2026-03-08 13:07:12.112421+00	$2b$10$FQdt6FfOWHQPOBloYvQMuOw9IZSoA/EcSuQNIFXIAbgYT.miV7c6W	\N	\N
30d1bc8f-4d1d-429e-9aec-67bf6bdc75f6	ac199157-3bc3-4792-9f84-4b6b80026d19	naiosh2021@gmail.com	\N	Dr Adnan	Abu Hameed	\N	t	2026-03-10 12:07:03.476667+00	2026-03-10 12:07:03.476667+00	$2b$10$eLL/G4XtF0y1d6n1/kplbO/AW/iVBKvhOWDjqMr.iQ0P4gDEfZlv6	\N	\N
311a7194-3c5f-4c9b-ba94-3f64d0663eca	6307963b-7063-4202-80c3-0200b33218c6	Abc@abc.com	\N	Abc	Xyz	\N	t	2026-03-10 12:20:41.009335+00	2026-03-10 12:20:41.009335+00	$2b$10$vAr26CQoje/5Sg7eL84aCO5ZmwQyTgH71x.34hX8Ae6F9njD/f9/y	\N	\N
d2113249-91cd-4d45-9384-c6e7c4417def	1da3fada-f597-4a2a-86c1-41cbb19dd456	abona@kolna.com	\N	abona	kolna	\N	t	2026-03-10 12:25:57.735094+00	2026-03-10 12:25:57.735094+00	$2b$10$NhT4EUtqS7.wfYbPCfWywedB7vQPJ6gHVZwxdxHQeikoG7Z40qyKW	\N	\N
130f5d3f-1d28-4ff9-8228-ff6477d18f51	74bf2ead-ebc3-4061-a988-778c2a16ff9e	adnan@poshasaudi.com	\N	Dr. Adnan	Abo Hameed	\N	t	2026-03-04 15:00:39.251816+00	2026-03-11 10:42:27.066816+00	$2b$10$5WBkr9otK0dyxvdzcLau1ey4nOzDbyeuyoyFDaEA2KSQrW4kVLdAe	b1bb30b57e77007fce73b1878d3e1c22f9bf756156c3855b71bb8e12094fbd1a	2026-03-11 11:42:27.06+00
f8735d7f-5b0b-4f58-8601-a3d3bb608bf9	fd0698bf-7c64-4cc6-939f-216e24111483	infosoqia@gmail.com	\N	ماجد	الخطيب	\N	t	2026-04-25 18:04:07.3186+00	2026-04-25 18:04:07.3186+00	$2b$10$laNEnjeAbMuw9uwamBvr6en2RpXMNHwpYc9wZs3O3SFcvFRzojHCC	\N	\N
8ba959e6-6094-43bb-be44-742ac473c97d	67cc3fea-70d6-4c48-87c4-93fee941cc53	infosoqia@gmail.com	\N	ماجد	الخطيب	\N	t	2026-04-26 07:29:44.797163+00	2026-04-26 07:29:44.797163+00	$2b$10$uZM7O.bhA1OrCiRfK0NDeeXKkaIpLuHPzgEvhy/ZcaJl13sKqT/Ze	\N	\N
e8ceaa68-62de-4a93-a634-72d42dfccca6	b524ae48-9a4e-467f-bdcf-1a6ee78d5c3c	naiosh2021@gmail.com	\N	ديمو	ديمو	\N	t	2026-04-27 05:30:52.678271+00	2026-04-27 05:30:52.678271+00	$2b$10$/0D8KZbcXfP.IWCjmsn0pO1AJvGTRJNWjio47XsPCvHq3fl7.0ikG	\N	\N
922e290c-9623-470f-a269-67ca4d121aed	8c46ae66-f491-4d42-9ec6-62a9800dff18	infosoqia@gmail.com	\N	ماجد	الخطيب	\N	t	2026-04-28 17:48:51.941272+00	2026-04-28 17:48:51.941272+00	$2b$10$ZrqkCBQZod74vWXgannReeIg1fjfLPj8QqxsvlDrDZrNJtVUFE7hO	\N	\N
354fa7ef-d5b5-41b7-9512-ca19f797cc37	da3939fd-10b0-4256-9f14-ef0fe93cd020	infosoqia@gmail.com	\N	ماجد	الخطيب	+962 786668371	t	2026-05-03 15:16:29.144045+00	2026-05-03 15:16:29.144045+00	$2b$10$aTuuujkt5UpUqZA8Glzy/eMOMNqHqtYxV1CTno8s5QmxOuX.pEHNG	\N	\N
\.


--
-- Data for Name: tenant_user_links; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tenant_user_links (id, tenant_id, platform_user_id, tenant_user_id, role, status, created_at, updated_at, revoked_at) FROM stdin;
a95185e9-6e97-4b76-b202-e51461387d12	74bf2ead-ebc3-4061-a988-778c2a16ff9e	fe8db022-ca78-40ec-a24a-ef8db89e7d2f	bf3a1ad0-d02e-4f22-bf7e-21ccbc5e5fae	ADMIN	active	2026-03-12 09:19:06.306408+00	2026-03-12 09:19:06.306408+00	\N
\.


--
-- Data for Name: tenants; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tenants (id, subdomain, company_name, status, subscription_plan, database_url_encrypted, database_name, created_at, updated_at, activated_at, suspended_at, deleted_at, max_users, max_courses, storage_quota_gb, custom_domain, settings) FROM stdin;
77ec1d51-2c26-47c7-b917-589cf643588e	reham	reham	pending_payment	basic	\\xc30d04070302ccd87f5951c5a0a77ad2a301736e8b19798f6fb7c4df838cdeb059a2a18ebfaa49c813ed8b5f87262cc7548fa04b971a9b6a94e0207c1ff82489375756afffeac0f89fa72738b23fd85e05f7684a3dfd9a0a4a4b7f3c7011ba13d27c1a70850077ebc759efc1915e03041fc6cc05e686d50e1c32e1acaa384ffe3ae42fa5339a7ebdf3c39bcfefeb862721ffe36b02268cb4b2f00c61a7a000dc91adf6115473476384d8cdf67ffb0109ef8d9be1	tenant_reham	2026-03-04 10:46:13.13754+00	2026-03-04 10:46:14.38829+00	\N	\N	\N	\N	\N	\N	\N	{}
3d2a7d54-eef4-4e2a-bc35-531dac0f2c39	xyz	Xyz	pending_payment	basic	\\xc30d04070302eda39ffef9c062957bd2a101ddac4e0a575b82bcb8f4ce471b58b3b262f37b9b2bf19ada2533fa01151dc7f594407350708eebbe0f62de2942efce4d29c7609bd5435677e6917651e1f08d73f0099c78da13a92585439c93184fad740a18f2ec8eb715c7eadd162690edd8e93156c3b81379fbc846acdfe1e8f04e964b1cd8f2124eae0e4af09a788a729b98de481284754fd086c369589969b5b0dff0d8480fbbc405dbefa19ca45096a86b	tenant_xyz	2026-03-04 13:34:03.718514+00	2026-03-04 13:34:04.458174+00	\N	\N	\N	\N	\N	\N	\N	{}
6a3960fb-4bee-435d-8c87-002eeaa5cfc3	rhema	123	pending_payment	basic	\\xc30d040703026f665d40bb6225fa66d2a301c30aca690c843a344fa682bf2b8843be617164080dad98d9f3dd225e781092b01fcf9d27338fb8c069fe0b1ecbf3c552f45e61d91bc23ffe06faa0eaa3694577fcffabf2f5c2f242840901ae8a186e2ea47ac637c802c9660e23a6783be721ab1a4d5fb40b8c4f55d6f02c85f15252456af1b7f8b94277c843666fad5ebf0db20573b589ba302b037d371405da26cb0469fbbb3101486799e00fff139bb7ec471624	tenant_rhema	2026-03-04 14:03:14.221659+00	2026-03-04 14:03:14.718259+00	\N	\N	\N	\N	\N	\N	\N	{}
b12cea5c-4611-4484-a7e1-97440c51eb68	tete	reham	active	basic	\\xc30d04070302356ac8fc9200490771d2a20167fb2a36eed4dbe8524a4414028d6fbfbd7c0f58cbcd325d5ce668c64ecb2e741dc0d1922c6401dae2f3f1e37cb4710998d1ad5b9ab5da56d95b3bad14d797d95484bce4f2f7212d3c656e0de65aaf66048dad5cce48199ccfd8709c89c221e5c178f8b6a6ff75e2864714b93a02a671f38d7e62166b116a0a9a6faf2cda6bd232e9e16caeac3902a568d0f74e305ac194dab199711b46ca10351dc3909087c6f2	tenant_tete	2026-03-04 14:13:43.414357+00	2026-03-04 14:13:43.948116+00	2026-03-04 14:13:43.414357+00	\N	\N	\N	\N	\N	\N	{}
a4f738cf-78ff-4291-9a36-ed20adff3934	yoyo	yoyo	active	basic	\\xc30d040703020d67e3231bbbd9e867d2a201843290626568f15ed52f2a21927ff95dadf3f43ef5b71be1618b08907c6975a0154560caa674e8854cffd5a327b077c6bc2c473bf367ac1a3c97b3374f30a279ae1ed1219ee651e401068a0ef6a0e91dfffa3b18d5aed0539ad8102becfb3df1ed30f00df927d50ffe982f4db2d259ec8a95c896b00b0a7120ae28506d4363860dd0e7932eadfd00fba1a5f5bace6b9c26b4317d31cbbb1b5d601b8524d73bc036	tenant_yoyo	2026-03-04 14:14:45.640506+00	2026-03-04 14:14:46.198498+00	2026-03-04 14:14:45.640506+00	\N	\N	\N	\N	\N	\N	{}
4ead1eb0-8dab-419d-953e-76e0142d80a5	tetette	reham	active	basic	\\xc30d04070302c91594b1b693f8d17cd2a501f7e2ef2fd6b6aa8b909039cf6b87eac8b6ff9f10c8967fe93ff0a9c9beba2dbdcf142d994385ba6a3a3e821a19ee1ff4628bacd8efa1fdd8a2eb35666b11cddfd8f39c2a80d30cd96876e54329395f6abde1468439a87196923282388c09b57f57ff73124afa27fbf2adee1b6d45b3335261a0fb93815a63607c1fe543595eb85490764afe9035125d36c76a6a3416a8e642f360020a0426787f8fa23cb827e7f2b74f22	tenant_tetette	2026-03-04 14:21:33.15412+00	2026-03-04 14:21:33.43554+00	2026-03-04 14:21:33.15412+00	\N	\N	\N	\N	\N	\N	{}
a19d448c-0018-466f-8f35-0b8eaf01e2f9	lara	lara	active	basic	\\xc30d0407030266efd5c9b1ae77f269d2a201974e20abc4a9dd3f2662af8285658cfe3f18855ae8cca6e120b315a7d064315f822cf386aa116b893bd6263008fb6a659679eb450732cba1b211f4839f75c6215ee4399674aed1aa71dfba77e36e169428cb926d09a9c0dc3d1d29020dea7e344be22ebbfbfdc83d8a773b352ce9cd25445bfebfa5c622959653dab63948f1e24f6b81823920e5dad948e4fcc649493f369d15b20a4bc669bcaa12b53ebe8c54a0	tenant_lara	2026-03-04 14:48:10.513136+00	2026-03-04 14:54:15.392322+00	2026-03-04 14:48:10.513136+00	\N	\N	\N	\N	\N	\N	{"pricing": {"plans": [{"id": "starter", "price": "$29/mo", "title": "Starter", "features": ["Up to 100 students", "Core LMS modules", "Email support"], "highlight": false, "description": "Launch-ready essentials for new academies."}, {"id": "growth", "price": "$99/mo", "title": "Growth", "features": ["Live classes", "Automation toolkit", "Priority support"], "highlight": true, "description": "Automation, live classes, and analytics."}, {"id": "enterprise", "price": "Custom", "title": "Enterprise", "features": ["Unlimited students", "Dedicated success manager", "Custom SLAs"], "highlight": false, "description": "Tailored infrastructure and white-glove onboarding."}], "ctaLabel": "Get started", "headline": "Flexible pricing for every academy", "subheading": "Scale confidently with transparent plans tailored to your growth."}, "branding": {"logoUrl": "/uploads/blog-images/image-1772635945443-f762f24b-e292-4127-ab5b-83f2de1c8f24.png", "heroBadge": "نص الشارة", "faviconUrl": "/uploads/blog-images/image-1772635948567-64accc77-25ea-4348-9fd0-d32ac519014e.png", "footerText": "نص التذييل", "accentColor": "#f97316", "heroSubtitle": "وصف البطل", "primaryColor": "#dc2626", "secondaryColor": "#0f172a", "pricingCtaLabel": "نص زر التسعير", "primaryCtaLabel": "نص زر الدعوة الأساسي", "heroTitleLeading": "عنوان البطل (البداية)", "secondaryCtaLabel": "نص زر الدعوة الثانوي", "heroTitleHighlight": "عنوان البطل (مميز)"}, "appearanceMeta": {"updatedAt": "2026-03-04T14:54:15.391Z", "updatedBy": "d7e2a8a9-caea-4870-8e94-058d0b70482d"}}
60a51aeb-86f2-442b-81e0-d2d07821af46	test	Tesr	active	basic	\\xc30d04070302a999855ddf53da5d7fd2a2016f57fbd5adadcdca5e754d2a285ff775c98fc0715865571ee20f788dde1ae97098754f94cf8ac05b1bdb0f364b14e1f874a37f39bf3c23fdcfc1a911f1087e93f958394bf49a77b7494dc2207db4ea28d8a68bf28d2d1e9f760df6473e0b0ad68a1c075e92b6251bd7563125f96c0f69d26bd603328dabb4c3792a06a05121bf96a46b0e0f8ff4d71c0d74d4db97ab67f3b4e03b5d4292d9d4764b91140e33ae50	tenant_test	2026-03-04 15:12:44.853293+00	2026-03-05 09:08:55.208847+00	2026-03-04 15:12:44.853293+00	\N	\N	\N	\N	\N	\N	{}
22ab2fce-c868-4648-8fdf-8eb629f9a494	reham1	reham1	active	basic	\\xc30d040703028788eaf4fd94f7986bd2a4017ad834160a9d3c546af802bee8ae1c9521ee7268cae1acbbdf7b1c73a119d655e41badcc5235970ba99b156127a525d2da5fe56d0f64dc6e9da716be36aa3021c4c2e6e50d4edf5a87251f6d100a6153f91b5bf22c4f37e0629d36f31031fbec004de132baa04aa75fc846588b02ae5985f7fd6343e8943812e71a30ae8b390ba85a97b49a7ddd494cdbf3a7db21d41b4d37ab75369c74675e213138186f10435ec510	tenant_reham1	2026-03-05 09:10:31.932038+00	2026-03-05 09:10:32.429006+00	2026-03-05 09:10:31.932038+00	\N	\N	\N	\N	\N	\N	{}
ac199157-3bc3-4792-9f84-4b6b80026d19	upacs	upacs	active	basic	\\xc30d04070302378dc494ee8e7d2f62d2a301d42df1c509235a5607b0397cc22c68182b6ef31155491d56fc3e4e49d6c0cfe33b5183fc6d5acbdb384ea63db7d7d6051b0c0fc98115599acdb3d32c1be99c04e18d0048f3e13750bbeb365f8fe1af27028d5e24367d53d7fad0d5bf33681a98cbca50b438905c1a9681b965734c114182e0d004518fb44d29c4b62dc93ca74360d936d1a399ec8f38236d0b614e5bc0073448f285e1bb57b0a31f4d32e3aee9e5c3	tenant_upacs	2026-03-10 12:07:03.476667+00	2026-03-10 12:07:03.898954+00	2026-03-10 12:07:03.476667+00	\N	\N	\N	\N	\N	\N	{}
6307963b-7063-4202-80c3-0200b33218c6	abc	abc	active	basic	\\xc30d0407030243e208588d905bee6ad2a1016dc01d9e963f3f9dfed5782d26eeab5f676b1ac1eb675dd97681f4cda14a54f4d37e1cdd11918c49ea092f17d0c5441839cd446bf1d012f85e0309e6186bd647fd22007776e636e57b7182d07040d39b7ebc2d8034e5e458ff98ff3d11437768b26a0dc04e37d5d2446fcc816e98226f41c05d713e8c9be0cd33b808b30e46c7229465fd4721b87944fff10aafd1d67814314918941cdc3a3db88af90fcf01db	tenant_abc	2026-03-10 12:20:41.009335+00	2026-03-10 12:20:41.439+00	2026-03-10 12:20:41.009335+00	\N	\N	\N	\N	\N	\N	{}
1da3fada-f597-4a2a-86c1-41cbb19dd456	abona	abona	active	basic	\\xc30d040703027f701e563a0281086ad2a301d10d385dcfc8de0307bed4e39f0f63408b599bbe70c28572a716c620a375bd41ac3574584d31ffffc378d397e972520cff8d91aac2b2132dc75d7b0445c6f28c06b4cecf28bcc32677efb64fa6740a4ade88a2ec853993ce855018527eb9adffbaf1d02a0925b64425b497c3bf48acdc23e0e21fb44ea9cfc93e0e87cd4f11e209d807fa045458b524581b62482e03147773febc69a1cf5d26ab562a8f02a8764de6	tenant_abona	2026-03-10 12:25:57.735094+00	2026-03-10 12:28:35.074563+00	2026-03-10 12:25:57.735094+00	\N	\N	\N	\N	\N	\N	{"pricing": {"plans": [{"id": "starter", "price": "$29/mo", "title": "Starter", "features": ["Up to 100 students", "Core LMS modules", "Email support"], "highlight": false, "description": "Launch-ready essentials for new academies."}, {"id": "growth", "price": "$99/mo", "title": "Growth", "features": ["Live classes", "Automation toolkit", "Priority support"], "highlight": true, "description": "Automation, live classes, and analytics."}, {"id": "enterprise", "price": "Custom", "title": "Enterprise", "features": ["Unlimited students", "Dedicated success manager", "Custom SLAs"], "highlight": false, "description": "Tailored infrastructure and white-glove onboarding."}], "ctaLabel": "Get started", "headline": "Flexible pricing for every academy", "subheading": "Scale confidently with transparent plans tailored to your growth."}, "branding": {"logoUrl": "/uploads/blog-images/image-1773145620623-16695bae-8284-45e0-a18b-ac15e279ff9e.png", "heroBadge": "والله العظيم", "faviconUrl": "/uploads/blog-images/image-1773145628077-94f59782-069f-4487-a300-79e653672fdd.png", "footerText": null, "accentColor": "#73a9e2", "heroSubtitle": "كنترول + أف 5 بتحل مشاكل كتير", "primaryColor": "#1552e0", "secondaryColor": "#0f172a", "pricingCtaLabel": null, "primaryCtaLabel": "يلا بينا", "heroTitleLeading": "أكاديمية تعليمية", "secondaryCtaLabel": "اعرف المزيد", "heroTitleHighlight": "أكاديمية ابونا كلنا"}, "appearanceMeta": {"updatedAt": "2026-03-10T12:28:35.071Z", "updatedBy": "d2113249-91cd-4d45-9384-c6e7c4417def"}}
7b05964c-da31-4212-9471-b9384d575715	sasha	sasha	active	basic	\\xc30d04070302c54ff29e6edb2ba464d2a3019929c8abbade838e794be14849b6ba5e11448b05879d3d0f6ffffd399eec9a2c6cdc6bdec3bea00e22429e90644dbfb968140474ac7fd8db85e5e993c7265bd111bd01f90475a797f420ec1fe2a1036fc225948e587643a7bdd7874a6595555c4a63b992512c51207160cbbb3b8f94adabfd3a7c0f1f5fe03d8a51dc854855f49d8a7e4899d653509e303c5cfb56965699f1330a5aaf447f27bc19ab1b1bbed79292	tenant_sasha	2026-03-08 13:07:12.112421+00	2026-03-17 12:26:11.015011+00	2026-03-08 13:07:12.112421+00	\N	\N	\N	\N	\N	\N	{"pricing": {"plans": [{"id": "starter", "price": "$29/mo", "title": "Starter", "features": ["Up to 100 students", "Core LMS modules", "Email support"], "highlight": false, "description": "Launch-ready essentials for new academies."}, {"id": "growth", "price": "$99/mo", "title": "Growth", "features": ["Live classes", "Automation toolkit", "Priority support"], "highlight": true, "description": "Automation, live classes, and analytics."}, {"id": "enterprise", "price": "Custom", "title": "Enterprise", "features": ["Unlimited students", "Dedicated success manager", "Custom SLAs"], "highlight": false, "description": "Tailored infrastructure and white-glove onboarding."}], "ctaLabel": "Get started", "headline": "Flexible pricing for every academy", "subheading": "Scale confidently with transparent plans tailored to your growth."}, "branding": {"logoUrl": "/beta-logo.png", "heroBadge": null, "faviconUrl": "/beta-logo.png", "footerText": null, "accentColor": "#155af9", "heroSubtitle": null, "primaryColor": "#96dd2c", "secondaryColor": "#c3c9b5", "pricingCtaLabel": null, "primaryCtaLabel": null, "heroTitleLeading": null, "secondaryCtaLabel": null, "heroBackgroundMode": "image", "heroTitleHighlight": null, "heroBackgroundColor": "#ada4a9", "announcementBarColor": "#96dd2c", "footerBackgroundColor": "#0b0b0b", "heroBackgroundImageUrl": "/uploads/blog-images/image-1773670789219-8b33c9a0-d31f-4796-bee4-2a90378199fb.jpeg", "heroBackgroundVideoUrl": "/uploads/blog-videos/video-1773662660438-040ac09f-cd31-4895-b239-bcc9c08fdf3c.mp4"}, "appearanceMeta": {"updatedAt": "2026-03-17T12:26:11.011Z", "updatedBy": "9baa5aa2-7b2e-4166-85ba-37433561fc90"}}
74bf2ead-ebc3-4061-a988-778c2a16ff9e	poshacademy	Posha Academy	active	basic	\\xc30d0407030282ff799e5528685964d2a9019acb5f1965d365f4ba84ad984be2dd2b54a431bd4dc5e3e06b9b1c179f913ecc58fc27f5c3c7d489c7c8b68184209c7523a0ca770d76d21616561e0dbfd3e0fc5a5b818d2d0751cb9d100250298313df7e9e327a6b07676173fcda56a306758c52a5bdb17567e0a9ba98445e1d5e5a412a81b4836dbbfeeb679f305cdd56d855b0c82272527f5090ed282ee9dddb3296ce5a9f6681b63231f561d0be981d54f85b21ca87274e3621	tenant_poshacademy	2026-03-04 15:00:39.251816+00	2026-04-01 08:49:52.610403+00	2026-03-04 15:00:39.251816+00	\N	\N	\N	\N	\N	\N	{"pricing": {"plans": [{"id": "starter", "price": "$29/mo", "title": "Starter", "features": ["Up to 100 students", "Core LMS modules", "Email support"], "highlight": false, "description": "Launch-ready essentials for new academies."}, {"id": "growth", "price": "$99/mo", "title": "Growth", "features": ["Live classes", "Automation toolkit", "Priority support"], "highlight": true, "description": "Automation, live classes, and analytics."}, {"id": "enterprise", "price": "Custom", "title": "Enterprise", "features": ["Unlimited students", "Dedicated success manager", "Custom SLAs"], "highlight": false, "description": "Tailored infrastructure and white-glove onboarding."}], "ctaLabel": "Get started", "headline": "Flexible pricing for every academy", "subheading": "Scale confidently with transparent plans tailored to your growth."}, "branding": {"logoUrl": "/uploads/blog-images/image-1774859619083-f3682dcd-52d9-4338-a735-61f4fe7f6271.png", "heroBadge": null, "faviconUrl": "/uploads/blog-images/image-1774859621039-648054d6-99e9-45b9-af35-c3a3e33f0893.png", "footerText": null, "accentColor": "#ffba8f", "heroSubtitle": null, "primaryColor": "#ff0026", "secondaryColor": "#403f4a", "pricingCtaLabel": null, "primaryCtaLabel": null, "heroMediaGallery": [{"id": "media_1775033370506_nkuyyd", "url": "/uploads/blog-images/image-1775033381809-81919ea4-f07d-4e54-bfbe-45b026699ca5.jpg", "order": 0, "mediaType": "image"}], "heroTitleLeading": "التدريب  المستدام", "secondaryCtaLabel": null, "heroBackgroundMode": "image", "heroTitleHighlight": "POSHAcademy", "heroBackgroundColor": "#051b7a", "announcementBarColor": "#7f1d1d", "footerBackgroundColor": "#0b0b0b", "heroBackgroundImageUrl": "/uploads/blog-images/image-1775033381809-81919ea4-f07d-4e54-bfbe-45b026699ca5.jpg", "heroBackgroundVideoUrl": ""}, "appearanceMeta": {"updatedAt": "2026-04-01T08:49:52.609Z", "updatedBy": "c5d37da0-6b55-4134-a9f8-53ff811e85e5"}}
fd0698bf-7c64-4cc6-939f-216e24111483	wego-academy	معا نمضي	active	basic	\\xc30d0407030295ec43f1345212346cd2aa017b3f2df79723463177fa18a17aa016d3fed6691bf3f7bc60caf386f91988fbf6ee17929db2be382eb6cae847e5d89e720e050fd442961860c7452cd087f941516edec35e24902f8634e5866aa565ef0dfab1c96ef7888ddf8c8e9b45a3d2130543e5e06244b338c5d12a54d3b6e6129247ff3600a944e3683c0fa3bc68c24950d76f63dd9a2c0f2f718da14386671db0a0981c5f9934e6422bb2bb5af034fb53c98a45b4d08d7fec61	tenant_wego_academy	2026-04-25 18:04:07.3186+00	2026-04-25 18:14:49.370905+00	2026-04-25 18:04:07.3186+00	\N	\N	\N	\N	\N	\N	{"pricing": {"plans": [{"id": "starter", "price": "$29/mo", "title": "Starter", "features": ["Up to 100 students", "Core LMS modules", "Email support"], "highlight": false, "description": "Launch-ready essentials for new academies."}, {"id": "growth", "price": "$99/mo", "title": "Growth", "features": ["Live classes", "Automation toolkit", "Priority support"], "highlight": true, "description": "Automation, live classes, and analytics."}, {"id": "enterprise", "price": "Custom", "title": "Enterprise", "features": ["Unlimited students", "Dedicated success manager", "Custom SLAs"], "highlight": false, "description": "Tailored infrastructure and white-glove onboarding."}], "ctaLabel": "Get started", "headline": "Flexible pricing for every academy", "subheading": "Scale confidently with transparent plans tailored to your growth."}, "branding": {"logoUrl": "/uploads/blog-images/image-1777140871504-8965b949-c4c2-49a2-aa23-b85aade7cdda.webp", "heroBadge": null, "faviconUrl": "/uploads/blog-images/image-1777140887740-11a2692f-6d8d-443f-a610-b1d3009a058b.png", "footerText": null, "accentColor": "#f97316", "heroSubtitle": null, "primaryColor": "#dc2626", "secondaryColor": "#0f172a", "pricingCtaLabel": null, "primaryCtaLabel": null, "heroMediaGallery": [{"id": "media_fallback_video_cdlja", "url": "/uploads/blog-videos/video-1774446689215-9b288f19-9eac-4e6e-ba6c-54df16ed0471.mp4", "order": 0, "mediaType": "video"}, {"id": "media_1774528614834_8t6jh4", "url": "/uploads/blog-images/image-1775980532736-e7675586-4830-4b0f-b84b-02315842c719.jpg", "order": 1, "mediaType": "image"}], "heroTitleLeading": null, "secondaryCtaLabel": null, "heroBackgroundMode": "video", "heroTitleHighlight": null, "heroBackgroundColor": "#020617", "announcementBarColor": "#7f1d1d", "footerBackgroundColor": "#0b0b0b", "heroBackgroundImageUrl": "/uploads/blog-images/image-1775980532736-e7675586-4830-4b0f-b84b-02315842c719.jpg", "heroBackgroundVideoUrl": "/uploads/blog-videos/video-1774446689215-9b288f19-9eac-4e6e-ba6c-54df16ed0471.mp4"}, "appearanceMeta": {"updatedAt": "2026-04-25T18:14:49.369Z", "updatedBy": "f8735d7f-5b0b-4f58-8601-a3d3bb608bf9"}}
67cc3fea-70d6-4c48-87c4-93fee941cc53	beauty	اكاديمية الجمال	active	basic	\\xc30d0407030287719ca94238e70c60d2a40153b9f63fe25c63d73db3a8f67d6149b80a18396f7c383586178d4460bd6a0e1d6ffbdfe3f1c563fe686941b8a140914ac94ab76984e4873b660ae9b758ca35e39901bd2059d6b7a57d7796aaee5e0daee51741df5bc080d7ea355fcfc2a38d900cd3c8c24199bdc05c78d7fbb43eda3e515453229ce0cac13312894721ccae95a2740cad8272f5f801217dba00fb27ab574f33d729b6e154f066405413c6168341fbaa	tenant_beauty	2026-04-26 07:29:44.797163+00	2026-04-26 07:29:45.104142+00	2026-04-26 07:29:44.797163+00	\N	\N	\N	\N	\N	\N	{}
b524ae48-9a4e-467f-bdcf-1a6ee78d5c3c	demo	demo	active	basic	\\xc30d04070302c8b021154363a4ac69d2a201f5d3bfdc7c8fafe4785e8faa73842a09c46b432a6dd646b5700d6ad78f16601c612a0e1ea4f442935a2f07dd6b75a59b51cc4577d70bc1bde0c9c2197a3f3f44c0febb21a2f67353151b129d0066d6d5cfb3ce3cacb51917a6c0deb24ac3068355e1190ff4cc6288344693c8b04a4abc6a5627941f7555ce2711202f4dcf61f90ec28fabf5f614e9650f9a80d40708c9a8032df12593f6a77fa3063005bf51d5bd	tenant_demo	2026-04-27 05:30:52.678271+00	2026-04-28 13:41:18.699517+00	2026-04-27 05:30:52.678271+00	\N	\N	\N	\N	\N	\N	{"pricing": {"plans": [{"id": "starter", "price": "$29/mo", "title": "Starter", "features": ["Up to 100 students", "Core LMS modules", "Email support"], "highlight": false, "description": "Launch-ready essentials for new academies."}, {"id": "growth", "price": "$99/mo", "title": "Growth", "features": ["Live classes", "Automation toolkit", "Priority support"], "highlight": true, "description": "Automation, live classes, and analytics."}, {"id": "enterprise", "price": "Custom", "title": "Enterprise", "features": ["Unlimited students", "Dedicated success manager", "Custom SLAs"], "highlight": false, "description": "Tailored infrastructure and white-glove onboarding."}], "ctaLabel": "Get started", "headline": "Flexible pricing for every academy", "subheading": "Scale confidently with transparent plans tailored to your growth."}, "branding": {"logoUrl": null, "heroBadge": null, "faviconUrl": null, "footerText": null, "accentColor": "#f97316", "heroSubtitle": null, "primaryColor": "#8f5656", "secondaryColor": "#6992f2", "pricingCtaLabel": null, "primaryCtaLabel": null, "heroMediaGallery": [{"id": "media_fallback_video_cdlja", "url": "/uploads/blog-images/image-1777272337855-8cd1a716-27e7-4dc6-8c43-66b574118b38.jpeg", "order": 0, "mediaType": "image"}, {"id": "media_1777272350947_0rzt83", "url": "/uploads/blog-videos/video-1777272698076-fb82c10a-21fb-4688-a3e6-75065382683c.mp4", "order": 1, "mediaType": "video"}], "heroTitleLeading": null, "secondaryCtaLabel": null, "heroBackgroundMode": "video", "heroTitleHighlight": null, "heroBackgroundColor": "#020617", "announcementBarColor": "#977d7d", "footerBackgroundColor": "#0b0b0b", "heroBackgroundImageUrl": "/uploads/blog-images/image-1777272337855-8cd1a716-27e7-4dc6-8c43-66b574118b38.jpeg", "heroBackgroundVideoUrl": "/uploads/blog-videos/video-1777272698076-fb82c10a-21fb-4688-a3e6-75065382683c.mp4"}, "appearanceMeta": {"updatedAt": "2026-04-28T13:41:18.698Z", "updatedBy": "f8d9eb09-851f-424e-a5b5-8e5146c0a012"}}
8c46ae66-f491-4d42-9ec6-62a9800dff18	wego	wego-academy	active	basic	\\xc30d04070302b367f74df8060e2d7fd2a2014c4869a45907a7014d6255701bc76a2d44cda64a37cc926b1852c3dd410dc51f286980bcbc48c3a2478448e148d7abd21d6909aa0f4fe90ac213a8e9f848b234251c19050fa521fbe4a08332b50e96d530368c4ecd47e25a94ba77bfe861b66b2b05d40990a9f8f9fee867003f78950d37062cb4e0b58857ffe583d52fa0f042b74272f01b0c2a138abf84d625100295473290e212be6f0ae090dedd823cc12e66	tenant_wego	2026-04-28 17:48:51.941272+00	2026-04-28 17:50:26.48445+00	2026-04-28 17:48:51.941272+00	\N	\N	\N	\N	\N	\N	{"pricing": {"plans": [{"id": "starter", "price": "$29/mo", "title": "Starter", "features": ["Up to 100 students", "Core LMS modules", "Email support"], "highlight": false, "description": "Launch-ready essentials for new academies."}, {"id": "growth", "price": "$99/mo", "title": "Growth", "features": ["Live classes", "Automation toolkit", "Priority support"], "highlight": true, "description": "Automation, live classes, and analytics."}, {"id": "enterprise", "price": "Custom", "title": "Enterprise", "features": ["Unlimited students", "Dedicated success manager", "Custom SLAs"], "highlight": false, "description": "Tailored infrastructure and white-glove onboarding."}], "ctaLabel": "Get started", "headline": "Flexible pricing for every academy", "subheading": "Scale confidently with transparent plans tailored to your growth."}, "branding": {"logoUrl": "/uploads/blog-images/image-1777398613487-11a781c8-de7e-4cb7-91f4-1b1e269d7835.webp", "heroBadge": null, "faviconUrl": "/uploads/blog-images/image-1777398623657-aa17526c-edfd-4ff9-87d3-9666c32d581e.png", "footerText": null, "accentColor": "#f97316", "heroSubtitle": null, "primaryColor": "#dc2626", "secondaryColor": "#0f172a", "pricingCtaLabel": null, "primaryCtaLabel": null, "heroMediaGallery": [{"id": "media_fallback_video_cdlja", "url": "/uploads/blog-videos/video-1774446689215-9b288f19-9eac-4e6e-ba6c-54df16ed0471.mp4", "order": 0, "mediaType": "video"}, {"id": "media_1774528614834_8t6jh4", "url": "/uploads/blog-images/image-1775980532736-e7675586-4830-4b0f-b84b-02315842c719.jpg", "order": 1, "mediaType": "image"}], "heroTitleLeading": null, "secondaryCtaLabel": null, "heroBackgroundMode": "video", "heroTitleHighlight": null, "heroBackgroundColor": "#020617", "announcementBarColor": "#7f1d1d", "footerBackgroundColor": "#0b0b0b", "heroBackgroundImageUrl": "/uploads/blog-images/image-1775980532736-e7675586-4830-4b0f-b84b-02315842c719.jpg", "heroBackgroundVideoUrl": "/uploads/blog-videos/video-1774446689215-9b288f19-9eac-4e6e-ba6c-54df16ed0471.mp4"}, "appearanceMeta": {"updatedAt": "2026-04-28T17:50:26.483Z", "updatedBy": "922e290c-9623-470f-a269-67ca4d121aed"}}
da3939fd-10b0-4256-9f14-ef0fe93cd020	atyaf	اطياف	active	basic	\\xc30d04070302597fa6fb1308441c7dd2a301453c786b122a997195e8220ab07b078d26bafe39c8d068f47e500220d07f08623f074f6a480feff91dbffd5b533181a1daeac812af5fdc413a147899628a7441b8937248e20c2ab7ba35540d314db651c8e7f5bb0b336cc13809e522ba21c75e96e3454656e07467ca6b6a9d0c959850a8f29294f54a01309c72385e1559d516cbb2593b9ab2cc88eda4b1b35ea6dfc872c03b1852ddab8ce2cc8f83b8d27b0a0baf	tenant_atyaf	2026-05-03 15:16:29.144045+00	2026-05-03 15:16:29.565682+00	2026-05-03 15:16:29.144045+00	\N	\N	\N	\N	\N	\N	{}
\.


--
-- Data for Name: transactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.transactions (id, user_id, course_id, amount, transacted_on, status, method) FROM stdin;
\.


--
-- Data for Name: user_roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.user_roles (id, user_id, role_id, assigned_by, assigned_at, expires_at, is_active, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, name, email, password, role, avatar, status, phone, join_date, last_active, plan, created_at, updated_at, enrolled_courses, credits, streak, last_login_date, notes, progress, specialization, bio, years_of_experience, portfolio_url, social_links, certifications, password_hash, last_activity_date, reset_token_hash, reset_token_expires, national_id, public_user_id, phone_country_code, gender, follow_up_status) FROM stdin;
e3bb66c5-f480-4c93-919e-3894219bbcc3	ياسين	sino1573010@gmail.com	\N	STUDENT	\N	Active	01555091684	2026-04-18	2026-04-18 16:45:29.509458+00	Free	2026-04-18 16:45:29.509458+00	2026-04-28 12:39:01.869301+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$Ax2mnvkU7XbE6PbrTFi4VuIm1RZhP9awLiSeXRzWYVjpJBAGb6h56	\N	\N	\N	\N	C-000004	\N	male	\N
e6cae855-6e61-4dd6-ac50-d8b0ccd790ff	Karim Wajih	ceo@kmwinvestment.com	\N	SUPER_ADMIN	\N	Active	01110537355	2026-03-02	2026-03-02 19:26:14.127073+00	Free	2026-03-02 19:26:14.127073+00	2026-04-28 12:39:07.419674+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$MmbghV9nL/rep2MR02fsD.8OKfTwyMWo.ydkQPj2AagTQOvtS.5r6	\N	\N	\N	\N	C-000001	\N	male	\N
dbb4e448-9dd9-4057-9aab-eee15de9d6eb	Naiosh	admin@betacdmy.com	\N	SUPER_ADMIN	\N	Active	\N	2026-03-02	2026-03-02 19:30:04.605376+00	Free	2026-03-02 19:30:04.605376+00	2026-04-28 12:40:16.241903+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$jcVA7qPVeKvlDTR872FLe.elRYfGoQg6FvzLaULxUxs68gZ6YlfIW	\N	\N	\N	\N	C-000002	\N	male	\N
d10a2902-a52f-4426-b2af-53716655ae5a	Jane Smith	jane.smith@example.com	\N	STUDENT	\N	Active	+0987654321	2026-03-08	2026-03-08 11:47:55.40702+00	Free	2026-03-08 11:47:55.40702+00	2026-04-27 11:09:25.735149+00	{91c5a9fe-797d-48ce-99e1-0fd00bf15531}	100	0	2026-03-08	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$ABdUzhs0EPKcZ7h7iN53XudjvqTskmEidlNu7NLrhzUviW8/1i4ve	\N	\N	\N	\N	C-000003	\N	\N	\N
ecfbd4c3-2eee-4237-883f-419f5d1558e3	admin	admin@test.com	\N	ADMIN	\N	Active	\N	2026-03-03	2026-03-03 08:13:32.295854+00	Enterprise	2026-03-03 08:13:32.295854+00	2026-04-27 11:09:25.735149+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$UleaSW04OadpiLhwMpJV7udiShDydBk7Ho9YyN/M9dY19Knk4T4ye	\N	\N	\N	\N	C-000009	\N	\N	\N
8731976c-262f-4a98-916e-8cfcb66e3d55	حسين الاحمد	jdbdjdebejej@gmail.com	\N	STUDENT	\N	Active	+963981203824	2026-03-06	2026-03-06 22:14:47.755677+00	Free	2026-03-06 22:14:47.755677+00	2026-04-27 11:09:25.735149+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$Pr6OwwNbpeBVe7e3NADtvu9VoUvfrO.cHgq1B8XFEoWxe5l1Nrt3C	\N	\N	\N	\N	C-000008	\N	\N	\N
871ac3b1-0b01-408e-98da-0e86ae31cda3	John Doe	john.doe@example.com	\N	STUDENT	\N	Active	+1234567890	2026-03-08	2026-03-08 11:47:55.297511+00	Free	2026-03-08 11:47:55.297511+00	2026-04-27 11:09:25.735149+00	{91c5a9fe-797d-48ce-99e1-0fd00bf15531}	100	0	2026-03-08	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$hTyNdg3vOywKXqaQFtJviOno3kNCB24s/dk9kJVCBN3HCnsVmp48C	\N	\N	\N	\N	C-000010	\N	\N	\N
c01ba4d7-b28a-48cb-92a3-7188f4c7f60b	testtt	testtt11@yahoo.com	\N	INSTRUCTOR	\N	Active	\N	2026-03-11	2026-03-11 08:53:19.810638+00	Enterprise	2026-03-11 08:53:19.810638+00	2026-04-27 11:09:25.735149+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$ydW/aqSjXYvaq51TZ1OYSOShX8C0uApTf63R76lferh3HKxrqDd82	\N	\N	\N	\N	C-000012	\N	\N	\N
63ea1749-9ad9-4af3-b401-eb324e5c80d9	tet	test12@yahoo.com	\N	ADMIN	\N	Active	\N	2026-03-11	2026-03-11 08:54:40.48383+00	Enterprise	2026-03-11 08:54:40.48383+00	2026-04-27 11:09:25.735149+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$rH8j9JYWN9qVnpBjEIQWn.LNrA8IyJjbxgpy2BM0sJyne04yTFc2S	\N	\N	\N	\N	C-000013	\N	\N	\N
2f98b901-c123-4e52-a3bb-6034bda0bebd	test	test22@yahoo.com	\N	SUPER_ADMIN	\N	Active	\N	2026-03-11	2026-03-11 08:56:14.574198+00	Enterprise	2026-03-11 08:56:14.574198+00	2026-04-27 11:09:25.735149+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$UTgLOsNydC9lVR84GgnaDu2gySbwWwySq/31sF5hz0Ay9V5Qebk4G	\N	\N	\N	\N	C-000014	\N	\N	\N
962a4886-1232-4b72-b308-78b0fbc57654	123	yahoo@yahoo.com	\N	INSTRUCTOR	\N	Active	\N	2026-03-11	2026-03-11 08:59:31.41177+00	Free	2026-03-11 08:59:31.41177+00	2026-04-27 11:09:25.735149+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$vnsiac7CARt4xAguVEx56.8V0P0zR3d6qKfPq61/uqDA.YAV1LZEm	\N	\N	\N	\N	C-000015	\N	\N	\N
227aa1d9-0f10-464d-b097-2eddbf843c61	signup test	testtt@yahoo.com	\N	ADMIN	\N	Active	\N	2026-03-11	2026-03-11 08:52:45.324019+00	Free	2026-03-11 08:52:45.324019+00	2026-04-27 11:09:25.735149+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$d3VsadLPRaYfk6zDZRAsleO4/UT33.nAov.lsbvtEDiDszFZxs9uy	\N	\N	\N	\N	C-000016	\N	\N	\N
6b85154c-ac33-4bb6-82a3-4129ece0b0b8	222	tet@tet.com	\N	VISITOR	\N	Active	\N	2026-03-11	2026-03-11 09:12:46.548668+00	Free	2026-03-11 09:12:46.548668+00	2026-04-27 11:09:25.735149+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$.X.gZFgfOKzNOjAVmvw/du5oFK.n1v/4BL4ZzYmoEJ6Brz5AQz0Wi	\N	\N	\N	\N	C-000017	\N	\N	\N
d4acfbd7-c67f-417e-8cfa-410b44d14e40	Ahmed Hassan	rehamkmw1@gmail.com	\N	INSTRUCTOR	\N	Active	\N	2026-03-08	2026-03-08 11:47:55.51236+00	Free	2026-03-08 11:47:55.51236+00	2026-04-27 11:09:25.735149+00	{91c5a9fe-797d-48ce-99e1-0fd00bf15531}	100	0	2026-03-08	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$v0QKcwAzgWxqgwJi8.AWr.aZY4AR8UK/vq/peBvf4cxYM5AeriS/C	\N	\N	\N	\N	C-000019	\N	\N	\N
d631ffd3-22c0-42d4-9d78-726765194984	admin	admin@tete.com	\N	ADMIN	\N	Active	\N	2026-03-29	2026-03-29 13:49:55.72263+00	Enterprise	2026-03-29 13:49:55.72263+00	2026-04-27 11:09:25.735149+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$of97wUDCirFsdei/knji8.Ky.TJRSlHYnYsFNszmD7qrOFVUVWurK	\N	\N	\N	\N	C-000026	\N	\N	\N
770e95b6-815e-4dad-bd5f-40e9235f9c36	Dr. Adnan Abuhameed	adnan@poshasaudi.com	\N	STUDENT	\N	Active	\N	2026-03-05	2026-03-05 07:48:26.988705+00	Free	2026-03-05 07:48:26.988705+00	2026-04-28 12:40:11.197548+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$l0ti88R2yWtcBdkeVA4LBuiqHZolzpYuHgFefkCbWY4CAXQ2F5Z.i	\N	\N	\N	\N	C-000006	\N	male	\N
19098280-9f65-4845-9e4a-cde8d3ffb589	reham	reham@membership.com	\N	MEMBER	\N	Active	123456789	2026-03-26	2026-03-26 10:54:07.961906+00	Free	2026-03-26 10:54:07.961906+00	2026-04-28 12:39:29.431485+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$fPNbAYBbYNRGRU2TSh7K9OowPf2vGRC2kPBm3kgn.mmahGvU.YU2G	\N	\N	\N	\N	C-000022	\N	female	\N
4f39e9d6-31b6-4500-a490-7b48d4ba1d3b	عبد السلام بيس	bdalslambys55@gmail.com	\N	STUDENT	\N	Active	04584535365	2026-03-23	2026-03-23 13:20:58.892976+00	Free	2026-03-23 13:20:58.892976+00	2026-04-28 12:38:54.931232+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$chJaiCLXFhkxPJrByGwP7.nYq5tqiJGcqKUs4FuEnTVWs5RyXyyw.	\N	\N	\N	\N	C-000021	\N	male	\N
817f9ffc-0013-43ca-a407-8fb4c4b0aeee	teacher	teacher11@reham.com	\N	INSTRUCTOR	\N	Active	+213 123456	2026-03-08	2026-03-08 11:40:43.591696+00	Enterprise	2026-03-08 11:40:43.591696+00	2026-04-28 10:02:37.624669+00	{}	0	0	\N	\N	\N	ai1111	السيرة الذاتية	5	\N	\N	\N	$2b$10$/VpMkqHqvsbnR08ulEolzOx/tzaGaUbVvp6RxwWcKhUwL82MNnphG	\N	\N	\N	\N	C-000011	DZ	\N	\N
8b0fd830-7cd2-4ec4-8f2f-71fe989d8534	test	test@num.com	\N	INSTRUCTOR	\N	Active	+93 123456789	2026-04-28	2026-04-28 08:47:06.948141+00	Enterprise	2026-04-28 08:47:06.948141+00	2026-04-28 11:17:56.721293+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$ofrWc7umYiQIRexzY7wcb.R1nlMCINT99Z19NWz2Qq5HPQcBYPofK	\N	\N	\N	123456	U-000001	AF	\N	Not interested
2f8f9343-75e6-47a8-b68a-47122eb10491	tetete	tete@gender.com	\N	STUDENT	\N	Active	+20 123456	2026-04-28	2026-04-28 10:34:04.431834+00	Free	2026-04-28 10:34:04.431834+00	2026-04-28 12:13:18.695161+00	{}	0	0	\N	\N	\N	jjj	\N	\N	\N	\N	\N	$2b$10$q4ujkYXEv82Ta9YyDFScfOsYgKqiTDKDdHRv9z5ewFSEUDagxRDgK	\N	\N	\N	12222	U-000002	EG	male	\N
7beff58d-8b08-4d9f-99e9-6af0315a15f2	Moha mmed	moamme924@gmail.com	\N	STUDENT	\N	Active	0908751612	2026-03-05	2026-03-05 12:26:24.328555+00	Free	2026-03-05 12:26:24.328555+00	2026-04-28 12:39:13.904611+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$qjIEeosyb4ecJShAeS3fiubFZfAq1yhTsNAKnfkyT7w6bq7S61hDu	\N	\N	\N	\N	C-000007	\N	male	\N
c1673f4b-14bd-4d09-aec2-77415da0cc2a	Majed Alkhateeb	infosoqia@gmail.com	\N	ADMIN	\N	Active	0786668371	2026-04-25	2026-04-25 18:01:47.216737+00	Enterprise	2026-04-25 18:01:47.216737+00	2026-04-28 12:39:22.192719+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$PsVDnVEGhqSMA86XlubDXuz0n9FnDnpDz9lPJmvuHGCteV/hD3Z/2	\N	\N	\N	\N	C-000018	\N	male	\N
35149d1d-04f9-46f4-92d4-de88ef4d537e	student	reham111@student.com	\N	STUDENT	\N	Active	11112222	2026-03-08	2026-03-29 09:15:00.571+00	Free	2026-03-08 11:37:54.79933+00	2026-04-28 12:39:39.431685+00	{91c5a9fe-797d-48ce-99e1-0fd00bf15531,f97933d6-66ae-4fc4-8697-93bc0eeebe17,4d748a62-23d3-4abb-9a7d-10874feffee5}	195	1	\N	\N	100	\N	\N	\N	\N	\N	\N	$2b$10$k8X2.wsReetvuNHYxqrtf.HyikZ.a9d5jsTAciizJU2iP8Y6qVJaq	2026-03-29	\N	\N	\N	C-000025	\N	female	\N
2662ca32-bb7e-43ff-b646-ab53715ddefd	reham	reham@paid.com	\N	MEMBER	\N	Active	123456	2026-03-26	2026-03-26 10:54:59.128026+00	Pro	2026-03-26 10:54:59.128026+00	2026-04-28 12:39:48.6248+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$pA1R4DGIvNl1mKlbbkeLm.7H6paMCHXL3HOOTgibB/Zo1r.3B8lDu	\N	\N	\N	\N	C-000023	\N	female	\N
753e7a4f-6639-4e2b-b957-4723cfc1c9a0	حافظ عبدالحليم عبدالحسين	almutarhafidh@gmail.com	\N	STUDENT	\N	Active	+964 7824647354	2026-04-08	2026-04-08 01:55:29.774497+00	Free	2026-04-08 01:55:29.774497+00	2026-04-28 12:39:56.798694+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$WbnrlFbk.7e9oSukp4tb0.rrBlzG7jjgiieL9elARxCA7lrdlULQK	\N	\N	\N	\N	C-000027	IQ	male	\N
aa0afda3-5d57-4d3d-bcbc-2d193e4a4d86	super admin	naiosh2021@gmail.com	\N	SUPER_ADMIN	\N	Active	\N	2026-03-05	2026-03-05 09:15:01.328292+00	Free	2026-03-05 09:15:01.328292+00	2026-04-28 12:40:24.5384+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$rbi6Zso/reIa7ULjDu6wdut0tiMUmQaF5GKYBLoGsWNbyYgSrITha	\N	\N	\N	\N	C-000020	\N	male	\N
fe8db022-ca78-40ec-a24a-ef8db89e7d2f	ابو حميد عدنان	naiosh2023@gmail.com	\N	INSTRUCTOR	\N	Active	\N	2026-03-05	2026-03-05 07:47:28.26615+00	Enterprise	2026-03-05 07:47:28.26615+00	2026-04-28 12:40:29.913585+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$Yzze/U/dNdhHltb72bDH0u1OnTU7/xHcOE5Tttmos0hodR7wU5GXu	\N	\N	\N	\N	C-000005	\N	male	\N
1eb6e8e5-484f-48dd-af27-822d3de953a9	علي رجب العلي	mohomssy1998@gmail.com	\N	STUDENT	\N	Active	\N	2026-04-18	2026-04-18 16:04:29.097121+00	Free	2026-04-18 16:04:29.097121+00	2026-04-28 12:40:35.208432+00	{}	0	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	$2b$10$g8.z/5lDEy6fK9mLoy3mu.PLZ3AmXJwCL8w5BYQbu9lbgo4EGG7nq	\N	\N	\N	\N	C-000028	\N	male	\N
3e35fafc-231d-492e-a0e7-1edffbe18940	natali	natali@test.com	\N	STUDENT	\N	Active	+213 1231111	2026-04-27	2026-04-27 09:15:39.02176+00	Free	2026-04-27 09:15:39.02176+00	2026-04-28 13:07:46.9339+00	{}	0	0	\N	\N	\N	برمجة	\N	\N	\N	\N	\N	$2b$10$25Scky5vHMriDofqHHHjqui5yqIbSpPNqNpb0epF4MjwQhW1ui/Pa	\N	\N	\N	123456	C-000024	DZ	female	Registered
\.


--
-- Name: rewards_config_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.rewards_config_id_seq', 1, true);


--
-- Name: users_public_user_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_public_user_id_seq', 2, true);


--
-- Name: ad_categories ad_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_categories
    ADD CONSTRAINT ad_categories_name_key UNIQUE (name);


--
-- Name: ad_categories ad_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_categories
    ADD CONSTRAINT ad_categories_pkey PRIMARY KEY (id);


--
-- Name: ads_announcements ads_announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_announcements
    ADD CONSTRAINT ads_announcements_pkey PRIMARY KEY (id);


--
-- Name: ads_display_settings ads_display_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_display_settings
    ADD CONSTRAINT ads_display_settings_pkey PRIMARY KEY (id);


--
-- Name: ads ads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads
    ADD CONSTRAINT ads_pkey PRIMARY KEY (id);


--
-- Name: ai_config ai_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_config
    ADD CONSTRAINT ai_config_pkey PRIMARY KEY (id);


--
-- Name: assignment_submissions assignment_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_submissions
    ADD CONSTRAINT assignment_submissions_pkey PRIMARY KEY (id);


--
-- Name: attendance_records attendance_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_pkey PRIMARY KEY (id);


--
-- Name: attendance_records attendance_records_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_unique UNIQUE (user_id, course_id, session_date);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: blog_posts blog_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blog_posts
    ADD CONSTRAINT blog_posts_pkey PRIMARY KEY (id);


--
-- Name: blog_posts blog_posts_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blog_posts
    ADD CONSTRAINT blog_posts_slug_key UNIQUE (slug);


--
-- Name: career_applications career_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.career_applications
    ADD CONSTRAINT career_applications_pkey PRIMARY KEY (id);


--
-- Name: central_live_platform_config central_live_platform_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.central_live_platform_config
    ADD CONSTRAINT central_live_platform_config_pkey PRIMARY KEY (id);


--
-- Name: central_schema_migrations central_schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.central_schema_migrations
    ADD CONSTRAINT central_schema_migrations_pkey PRIMARY KEY (filename);


--
-- Name: central_seo_settings central_seo_settings_page_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.central_seo_settings
    ADD CONSTRAINT central_seo_settings_page_path_key UNIQUE (page_path);


--
-- Name: central_seo_settings central_seo_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.central_seo_settings
    ADD CONSTRAINT central_seo_settings_pkey PRIMARY KEY (id);


--
-- Name: certificates certificates_certification_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificates
    ADD CONSTRAINT certificates_certification_number_key UNIQUE (certification_number);


--
-- Name: certificates certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificates
    ADD CONSTRAINT certificates_pkey PRIMARY KEY (id);


--
-- Name: conversation_participants conversation_participants_conversation_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_conversation_id_user_id_key UNIQUE (conversation_id, user_id);


--
-- Name: conversation_participants conversation_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_pkey PRIMARY KEY (id);


--
-- Name: course_categories course_categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_categories
    ADD CONSTRAINT course_categories_name_key UNIQUE (name);


--
-- Name: course_categories course_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_categories
    ADD CONSTRAINT course_categories_pkey PRIMARY KEY (id);


--
-- Name: course_payments course_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_payments
    ADD CONSTRAINT course_payments_pkey PRIMARY KEY (id);


--
-- Name: course_payments course_payments_receipt_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_payments
    ADD CONSTRAINT course_payments_receipt_id_key UNIQUE (receipt_id);


--
-- Name: course_progress course_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_progress
    ADD CONSTRAINT course_progress_pkey PRIMARY KEY (id);


--
-- Name: course_progress course_progress_user_id_course_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_progress
    ADD CONSTRAINT course_progress_user_id_course_id_key UNIQUE (user_id, course_id);


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);


--
-- Name: credit_redemption_options credit_redemption_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_redemption_options
    ADD CONSTRAINT credit_redemption_options_pkey PRIMARY KEY (id);


--
-- Name: credit_redemptions credit_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_redemptions
    ADD CONSTRAINT credit_redemptions_pkey PRIMARY KEY (id);


--
-- Name: credit_transactions credit_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_pkey PRIMARY KEY (id);


--
-- Name: discounts discounts_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discounts
    ADD CONSTRAINT discounts_code_key UNIQUE (code);


--
-- Name: discounts discounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discounts
    ADD CONSTRAINT discounts_pkey PRIMARY KEY (id);


--
-- Name: email_settings email_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_settings
    ADD CONSTRAINT email_settings_pkey PRIMARY KEY (id);


--
-- Name: enrollments enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_pkey PRIMARY KEY (id);


--
-- Name: enrollments enrollments_user_id_course_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_user_id_course_id_key UNIQUE (user_id, course_id);


--
-- Name: freelancer_submissions freelancer_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.freelancer_submissions
    ADD CONSTRAINT freelancer_submissions_pkey PRIMARY KEY (id);


--
-- Name: instructor_assignments instructor_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_assignments
    ADD CONSTRAINT instructor_assignments_pkey PRIMARY KEY (id);


--
-- Name: instructor_payouts instructor_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_payouts
    ADD CONSTRAINT instructor_payouts_pkey PRIMARY KEY (id);


--
-- Name: live_class_invites live_class_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_class_invites
    ADD CONSTRAINT live_class_invites_pkey PRIMARY KEY (id);


--
-- Name: live_classes live_classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_classes
    ADD CONSTRAINT live_classes_pkey PRIMARY KEY (id);


--
-- Name: live_platform_config live_platform_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_platform_config
    ADD CONSTRAINT live_platform_config_pkey PRIMARY KEY (id);


--
-- Name: media_settings media_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_settings
    ADD CONSTRAINT media_settings_pkey PRIMARY KEY (id);


--
-- Name: membership_submissions membership_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_submissions
    ADD CONSTRAINT membership_submissions_pkey PRIMARY KEY (id);


--
-- Name: message_audit_logs message_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_audit_logs
    ADD CONSTRAINT message_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: message_blocks message_blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_blocks
    ADD CONSTRAINT message_blocks_pkey PRIMARY KEY (id);


--
-- Name: message_conversations message_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_conversations
    ADD CONSTRAINT message_conversations_pkey PRIMARY KEY (id);


--
-- Name: message_participants message_participants_conversation_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_participants
    ADD CONSTRAINT message_participants_conversation_id_user_id_key UNIQUE (conversation_id, user_id);


--
-- Name: message_participants message_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_participants
    ADD CONSTRAINT message_participants_pkey PRIMARY KEY (id);


--
-- Name: message_receipts message_receipts_conversation_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_receipts
    ADD CONSTRAINT message_receipts_conversation_id_user_id_key UNIQUE (conversation_id, user_id);


--
-- Name: message_receipts message_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_receipts
    ADD CONSTRAINT message_receipts_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: payment_gateway_config payment_gateway_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_gateway_config
    ADD CONSTRAINT payment_gateway_config_pkey PRIMARY KEY (id);


--
-- Name: payment_refunds payment_refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_refunds
    ADD CONSTRAINT payment_refunds_pkey PRIMARY KEY (id);


--
-- Name: payment_refunds payment_refunds_refund_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_refunds
    ADD CONSTRAINT payment_refunds_refund_id_key UNIQUE (refund_id);


--
-- Name: payment_refunds payment_refunds_stripe_refund_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_refunds
    ADD CONSTRAINT payment_refunds_stripe_refund_id_key UNIQUE (stripe_refund_id);


--
-- Name: payment_transactions payment_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_name_key UNIQUE (name);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: provisioning_logs provisioning_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provisioning_logs
    ADD CONSTRAINT provisioning_logs_pkey PRIMARY KEY (id);


--
-- Name: rewards_config rewards_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rewards_config
    ADD CONSTRAINT rewards_config_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_role_id_permission_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_permission_id_key UNIQUE (role_id, permission_id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (scope, filename);


--
-- Name: seo_overrides seo_overrides_content_type_content_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seo_overrides
    ADD CONSTRAINT seo_overrides_content_type_content_id_key UNIQUE (content_type, content_id);


--
-- Name: seo_overrides seo_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seo_overrides
    ADD CONSTRAINT seo_overrides_pkey PRIMARY KEY (id);


--
-- Name: seo_settings seo_settings_page_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seo_settings
    ADD CONSTRAINT seo_settings_page_path_key UNIQUE (page_path);


--
-- Name: seo_settings seo_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seo_settings
    ADD CONSTRAINT seo_settings_pkey PRIMARY KEY (id);


--
-- Name: static_pages static_pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.static_pages
    ADD CONSTRAINT static_pages_pkey PRIMARY KEY (slug);


--
-- Name: subscription_plan_prices subscription_plan_prices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plan_prices
    ADD CONSTRAINT subscription_plan_prices_pkey PRIMARY KEY (id);


--
-- Name: subscription_plans subscription_plans_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_code_key UNIQUE (code);


--
-- Name: subscription_plans subscription_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);


--
-- Name: subscription_refunds subscription_refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_refunds
    ADD CONSTRAINT subscription_refunds_pkey PRIMARY KEY (id);


--
-- Name: subscription_refunds subscription_refunds_refund_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_refunds
    ADD CONSTRAINT subscription_refunds_refund_id_key UNIQUE (refund_id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: system_settings system_settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_key_key UNIQUE (key);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (id);


--
-- Name: tenant_admins tenant_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_admins
    ADD CONSTRAINT tenant_admins_pkey PRIMARY KEY (id);


--
-- Name: tenant_admins tenant_admins_tenant_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_admins
    ADD CONSTRAINT tenant_admins_tenant_id_email_key UNIQUE (tenant_id, email);


--
-- Name: tenant_user_links tenant_user_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_user_links
    ADD CONSTRAINT tenant_user_links_pkey PRIMARY KEY (id);


--
-- Name: tenant_user_links tenant_user_links_tenant_id_platform_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_user_links
    ADD CONSTRAINT tenant_user_links_tenant_id_platform_user_id_key UNIQUE (tenant_id, platform_user_id);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_subdomain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_subdomain_key UNIQUE (subdomain);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: media_settings unique_tenant_media_setting; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_settings
    ADD CONSTRAINT unique_tenant_media_setting UNIQUE (tenant_id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_id_key UNIQUE (user_id, role_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_ads_announcements_sequence; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_announcements_sequence ON public.ads_announcements USING btree (enabled, show_in_top_bar, sort_order, created_at DESC);


--
-- Name: idx_ads_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_category ON public.ads USING btree (category_id);


--
-- Name: idx_ads_featured; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_featured ON public.ads USING btree (is_featured);


--
-- Name: idx_ads_status_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ads_status_created_at ON public.ads USING btree (status, created_at DESC);


--
-- Name: idx_assignment_submissions_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_submissions_course ON public.assignment_submissions USING btree (course_id);


--
-- Name: idx_assignment_submissions_instructor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_submissions_instructor ON public.assignment_submissions USING btree (instructor_id, status, created_at DESC);


--
-- Name: idx_assignment_submissions_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assignment_submissions_student ON public.assignment_submissions USING btree (student_id, course_id, created_at DESC);


--
-- Name: idx_attendance_last_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_last_active ON public.attendance_records USING btree (last_active DESC);


--
-- Name: idx_attendance_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_attendance_user_date ON public.attendance_records USING btree (user_id, session_date DESC);


--
-- Name: idx_audit_logs_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_action ON public.audit_logs USING btree (action);


--
-- Name: idx_audit_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_audit_logs_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_resource ON public.audit_logs USING btree (resource_type, resource_id);


--
-- Name: idx_audit_logs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_status ON public.audit_logs USING btree (status);


--
-- Name: idx_audit_logs_tenant_action_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_tenant_action_created ON public.audit_logs USING btree (tenant_id, action, created_at DESC);


--
-- Name: idx_audit_logs_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_tenant_id ON public.audit_logs USING btree (tenant_id);


--
-- Name: idx_audit_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user_id ON public.audit_logs USING btree (user_id);


--
-- Name: idx_blog_posts_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_blog_posts_category ON public.blog_posts USING btree (category);


--
-- Name: idx_blog_posts_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_blog_posts_slug ON public.blog_posts USING btree (slug);


--
-- Name: idx_blog_posts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_blog_posts_status ON public.blog_posts USING btree (status);


--
-- Name: idx_career_applications_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_career_applications_email ON public.career_applications USING btree (applicant_email);


--
-- Name: idx_career_applications_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_career_applications_job ON public.career_applications USING btree (job_id, created_at DESC);


--
-- Name: idx_central_seo_settings_page_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_central_seo_settings_page_path ON public.central_seo_settings USING btree (page_path);


--
-- Name: idx_central_seo_settings_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_central_seo_settings_updated_at ON public.central_seo_settings USING btree (updated_at DESC);


--
-- Name: idx_course_categories_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_categories_name ON public.course_categories USING btree (name);


--
-- Name: idx_course_payments_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_payments_course ON public.course_payments USING btree (course_id);


--
-- Name: idx_course_payments_instructor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_payments_instructor ON public.course_payments USING btree (instructor_id);


--
-- Name: idx_course_payments_method; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_payments_method ON public.course_payments USING btree (payment_method);


--
-- Name: idx_course_payments_received_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_payments_received_at ON public.course_payments USING btree (received_at DESC);


--
-- Name: idx_course_payments_stripe_payment_intent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_payments_stripe_payment_intent ON public.course_payments USING btree (stripe_payment_intent_id) WHERE (stripe_payment_intent_id IS NOT NULL);


--
-- Name: idx_course_payments_stripe_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_payments_stripe_session ON public.course_payments USING btree (stripe_session_id) WHERE (stripe_session_id IS NOT NULL);


--
-- Name: idx_course_payments_student; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_payments_student ON public.course_payments USING btree (student_id, course_id);


--
-- Name: idx_course_progress_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_progress_user ON public.course_progress USING btree (user_id);


--
-- Name: idx_courses_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_courses_category ON public.courses USING btree (category);


--
-- Name: idx_courses_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_courses_created_by ON public.courses USING btree (created_by);


--
-- Name: idx_courses_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_courses_language ON public.courses USING btree (language);


--
-- Name: idx_courses_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_courses_status ON public.courses USING btree (status);


--
-- Name: idx_credit_redemptions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_redemptions_user ON public.credit_redemptions USING btree (user_id, created_at DESC);


--
-- Name: idx_credit_redemptions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_redemptions_user_id ON public.credit_redemptions USING btree (user_id, created_at DESC);


--
-- Name: idx_credit_transactions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_transactions_user ON public.credit_transactions USING btree (user_id, created_at DESC);


--
-- Name: idx_credit_transactions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_credit_transactions_user_id ON public.credit_transactions USING btree (user_id, created_at DESC);


--
-- Name: idx_email_settings_central_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_settings_central_unique ON public.email_settings USING btree (scope) WHERE (((scope)::text = 'central'::text) AND (tenant_id IS NULL));


--
-- Name: idx_email_settings_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_settings_tenant_id ON public.email_settings USING btree (tenant_id) WHERE (tenant_id IS NOT NULL);


--
-- Name: idx_email_settings_tenant_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_settings_tenant_unique ON public.email_settings USING btree (tenant_id) WHERE ((scope)::text = 'tenant'::text);


--
-- Name: idx_enrollments_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_course ON public.enrollments USING btree (course_id);


--
-- Name: idx_enrollments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrollments_user ON public.enrollments USING btree (user_id);


--
-- Name: idx_freelancer_submissions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_freelancer_submissions_created_at ON public.freelancer_submissions USING btree (created_at DESC);


--
-- Name: idx_freelancer_submissions_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_freelancer_submissions_email ON public.freelancer_submissions USING btree (lower(email));


--
-- Name: idx_freelancer_submissions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_freelancer_submissions_status ON public.freelancer_submissions USING btree (status);


--
-- Name: idx_instructor_assignments_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instructor_assignments_course ON public.instructor_assignments USING btree (course_id);


--
-- Name: idx_instructor_assignments_instructor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instructor_assignments_instructor ON public.instructor_assignments USING btree (instructor_id, created_at DESC);


--
-- Name: idx_instructor_payouts_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instructor_payouts_course ON public.instructor_payouts USING btree (course_id);


--
-- Name: idx_instructor_payouts_instructor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instructor_payouts_instructor ON public.instructor_payouts USING btree (instructor_id, recorded_at DESC);


--
-- Name: idx_instructor_payouts_method; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instructor_payouts_method ON public.instructor_payouts USING btree (payment_method);


--
-- Name: idx_instructor_payouts_recorded_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_instructor_payouts_recorded_at ON public.instructor_payouts USING btree (recorded_at DESC);


--
-- Name: idx_media_settings_tenant_coalesced_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_media_settings_tenant_coalesced_unique ON public.media_settings USING btree (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));


--
-- Name: idx_media_settings_tenant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_media_settings_tenant_id ON public.media_settings USING btree (tenant_id);


--
-- Name: idx_membership_submissions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_membership_submissions_created_at ON public.membership_submissions USING btree (created_at DESC);


--
-- Name: idx_membership_submissions_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_membership_submissions_email ON public.membership_submissions USING btree (lower(email));


--
-- Name: idx_membership_submissions_type_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_membership_submissions_type_status ON public.membership_submissions USING btree (membership_type, status);


--
-- Name: idx_message_blocks_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_blocks_active ON public.message_blocks USING btree (user_id) WHERE (active = true);


--
-- Name: idx_message_receipts_conv_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_receipts_conv_user ON public.message_receipts USING btree (conversation_id, user_id);


--
-- Name: idx_messages_conversation_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_conversation_created_at ON public.messages USING btree (conversation_id, created_at DESC);


--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (user_id, is_read, created_at DESC);


--
-- Name: idx_notifications_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: idx_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id) WHERE (read = false);


--
-- Name: idx_payment_refunds_payment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_refunds_payment_id ON public.payment_refunds USING btree (payment_id);


--
-- Name: idx_payment_refunds_refunded_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_refunds_refunded_at ON public.payment_refunds USING btree (refunded_at DESC);


--
-- Name: idx_payment_refunds_refunded_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_refunds_refunded_by ON public.payment_refunds USING btree (refunded_by);


--
-- Name: idx_payment_refunds_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_refunds_status ON public.payment_refunds USING btree (status);


--
-- Name: idx_payment_refunds_stripe_refund_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_refunds_stripe_refund_id ON public.payment_refunds USING btree (stripe_refund_id) WHERE (stripe_refund_id IS NOT NULL);


--
-- Name: idx_payment_transactions_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_payment_transactions_reference ON public.payment_transactions USING btree (transaction_reference) WHERE (transaction_reference IS NOT NULL);


--
-- Name: idx_payment_transactions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_transactions_status ON public.payment_transactions USING btree (status);


--
-- Name: idx_payment_transactions_subscription; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_transactions_subscription ON public.payment_transactions USING btree (subscription_id);


--
-- Name: idx_payment_transactions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_transactions_tenant ON public.payment_transactions USING btree (tenant_id);


--
-- Name: idx_payment_transactions_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_transactions_updated_at ON public.payment_transactions USING btree (updated_at DESC);


--
-- Name: idx_permissions_resource_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_permissions_resource_action ON public.permissions USING btree (resource, action);


--
-- Name: idx_provisioning_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provisioning_logs_created_at ON public.provisioning_logs USING btree (created_at DESC);


--
-- Name: idx_provisioning_logs_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provisioning_logs_started ON public.provisioning_logs USING btree (started_at DESC);


--
-- Name: idx_provisioning_logs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provisioning_logs_status ON public.provisioning_logs USING btree (status);


--
-- Name: idx_provisioning_logs_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provisioning_logs_tenant ON public.provisioning_logs USING btree (tenant_id);


--
-- Name: idx_provisioning_logs_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_provisioning_logs_updated_at ON public.provisioning_logs USING btree (updated_at DESC);


--
-- Name: idx_role_permissions_permission; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_permissions_permission ON public.role_permissions USING btree (permission_id);


--
-- Name: idx_role_permissions_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_role_permissions_role ON public.role_permissions USING btree (role_id);


--
-- Name: idx_seo_overrides_content; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seo_overrides_content ON public.seo_overrides USING btree (content_type, content_id);


--
-- Name: idx_seo_settings_page_path; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seo_settings_page_path ON public.seo_settings USING btree (page_path);


--
-- Name: idx_seo_settings_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_seo_settings_updated_at ON public.seo_settings USING btree (updated_at DESC);


--
-- Name: idx_subscription_plan_prices_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_plan_prices_is_active ON public.subscription_plan_prices USING btree (is_active);


--
-- Name: idx_subscription_plan_prices_plan_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_plan_prices_plan_cycle ON public.subscription_plan_prices USING btree (plan_id, billing_cycle, valid_from);


--
-- Name: idx_subscription_plan_prices_plan_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_plan_prices_plan_id ON public.subscription_plan_prices USING btree (plan_id);


--
-- Name: idx_subscription_plan_prices_valid_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_plan_prices_valid_from ON public.subscription_plan_prices USING btree (valid_from);


--
-- Name: idx_subscription_plans_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscription_plans_code ON public.subscription_plans USING btree (code);


--
-- Name: idx_subscription_plans_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_plans_is_active ON public.subscription_plans USING btree (is_active);


--
-- Name: idx_subscription_refunds_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_refunds_payment ON public.subscription_refunds USING btree (payment_transaction_id);


--
-- Name: idx_subscription_refunds_refunded_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_refunds_refunded_at ON public.subscription_refunds USING btree (refunded_at DESC);


--
-- Name: idx_subscription_refunds_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_refunds_status ON public.subscription_refunds USING btree (status);


--
-- Name: idx_subscription_refunds_stripe_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_refunds_stripe_id ON public.subscription_refunds USING btree (stripe_refund_id) WHERE (stripe_refund_id IS NOT NULL);


--
-- Name: idx_subscription_refunds_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscription_refunds_tenant ON public.subscription_refunds USING btree (tenant_id);


--
-- Name: idx_subscriptions_active_with_locked_price; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscriptions_active_with_locked_price ON public.subscriptions USING btree (tenant_id) WHERE (((status)::text = 'active'::text) AND (locked_amount IS NOT NULL));


--
-- Name: idx_subscriptions_plan_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_plan_id ON public.subscriptions USING btree (plan_id);


--
-- Name: idx_subscriptions_price_snapshot_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_price_snapshot_gin ON public.subscriptions USING gin (price_snapshot);


--
-- Name: idx_subscriptions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_status ON public.subscriptions USING btree (status);


--
-- Name: idx_subscriptions_stripe_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_stripe_id ON public.subscriptions USING btree (stripe_subscription_id);


--
-- Name: idx_subscriptions_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_subscriptions_tenant ON public.subscriptions USING btree (tenant_id);


--
-- Name: idx_subscriptions_tenant_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscriptions_tenant_active ON public.subscriptions USING btree (tenant_id) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_system_settings_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_settings_category ON public.system_settings USING btree (category);


--
-- Name: idx_system_settings_is_public; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_settings_is_public ON public.system_settings USING btree (is_public);


--
-- Name: idx_system_settings_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_system_settings_key ON public.system_settings USING btree (key);


--
-- Name: idx_tenant_admins_password_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_admins_password_hash ON public.tenant_admins USING btree (password_hash) WHERE (password_hash IS NOT NULL);


--
-- Name: idx_tenant_admins_reset_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_admins_reset_token_hash ON public.tenant_admins USING btree (reset_token_hash) WHERE (reset_token_hash IS NOT NULL);


--
-- Name: idx_tenant_admins_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_admins_tenant ON public.tenant_admins USING btree (tenant_id);


--
-- Name: idx_tenant_admins_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_admins_updated_at ON public.tenant_admins USING btree (updated_at DESC);


--
-- Name: idx_tenant_user_links_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_user_links_platform ON public.tenant_user_links USING btree (platform_user_id);


--
-- Name: idx_tenant_user_links_tenant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenant_user_links_tenant ON public.tenant_user_links USING btree (tenant_id);


--
-- Name: idx_tenants_activated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_activated_at ON public.tenants USING btree (activated_at) WHERE (activated_at IS NOT NULL);


--
-- Name: idx_tenants_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tenants_status ON public.tenants USING btree (status);


--
-- Name: idx_tenants_subdomain; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tenants_subdomain ON public.tenants USING btree (subdomain);


--
-- Name: idx_user_roles_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_active ON public.user_roles USING btree (user_id, is_active) WHERE (is_active = true);


--
-- Name: idx_user_roles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_role ON public.user_roles USING btree (role_id);


--
-- Name: idx_user_roles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_roles_user ON public.user_roles USING btree (user_id);


--
-- Name: idx_users_email_lower; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email_lower ON public.users USING btree (lower(email));


--
-- Name: idx_users_last_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_last_active ON public.users USING btree (last_active DESC);


--
-- Name: idx_users_password_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_password_hash ON public.users USING btree (password_hash) WHERE (password_hash IS NOT NULL);


--
-- Name: idx_users_public_user_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_public_user_id_unique ON public.users USING btree (public_user_id);


--
-- Name: idx_users_reset_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_reset_token_hash ON public.users USING btree (reset_token_hash) WHERE (reset_token_hash IS NOT NULL);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_users_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_status ON public.users USING btree (status);


--
-- Name: blog_posts blog_posts_auto_slug; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER blog_posts_auto_slug BEFORE INSERT OR UPDATE ON public.blog_posts FOR EACH ROW EXECUTE FUNCTION public.auto_generate_blog_slug();


--
-- Name: subscriptions trg_generate_subscription_price_snapshot; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_generate_subscription_price_snapshot BEFORE INSERT OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.generate_subscription_price_snapshot();


--
-- Name: permissions trg_permissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_permissions_updated_at BEFORE UPDATE ON public.permissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: roles trg_roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: ai_config trg_set_ai_config_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_ai_config_updated_at BEFORE UPDATE ON public.ai_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: email_settings trg_set_email_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_email_settings_updated_at BEFORE UPDATE ON public.email_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: media_settings trg_set_media_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_media_settings_updated_at BEFORE UPDATE ON public.media_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payment_gateway_config trg_set_payment_gateway_config_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_payment_gateway_config_updated_at BEFORE UPDATE ON public.payment_gateway_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: payment_transactions trg_set_payment_transactions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_payment_transactions_updated_at BEFORE UPDATE ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: provisioning_logs trg_set_provisioning_logs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_provisioning_logs_updated_at BEFORE UPDATE ON public.provisioning_logs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscription_plan_prices trg_set_subscription_plan_prices_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_subscription_plan_prices_updated_at BEFORE UPDATE ON public.subscription_plan_prices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscription_plans trg_set_subscription_plans_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_subscription_plans_updated_at BEFORE UPDATE ON public.subscription_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscription_refunds trg_set_subscription_refunds_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_subscription_refunds_updated_at BEFORE UPDATE ON public.subscription_refunds FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscriptions trg_set_subscriptions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: system_settings trg_set_system_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_system_settings_updated_at BEFORE UPDATE ON public.system_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tenant_admins trg_set_tenant_admins_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_tenant_admins_updated_at BEFORE UPDATE ON public.tenant_admins FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tenant_user_links trg_set_tenant_user_links_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_tenant_user_links_updated_at BEFORE UPDATE ON public.tenant_user_links FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: tenants trg_set_tenants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_set_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: subscriptions trg_subscriptions_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_subscriptions_audit BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: user_roles trg_user_roles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_user_roles_updated_at BEFORE UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: subscriptions trg_validate_subscription_locked_pricing; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validate_subscription_locked_pricing BEFORE INSERT OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.validate_subscription_locked_pricing();


--
-- Name: central_seo_settings trigger_update_central_seo_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_central_seo_settings_updated_at BEFORE UPDATE ON public.central_seo_settings FOR EACH ROW EXECUTE FUNCTION public.update_central_seo_settings_updated_at();


--
-- Name: payment_refunds trigger_update_payment_refunds_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_payment_refunds_updated_at BEFORE UPDATE ON public.payment_refunds FOR EACH ROW EXECUTE FUNCTION public.update_payment_refunds_updated_at();


--
-- Name: seo_overrides trigger_update_seo_overrides_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_seo_overrides_updated_at BEFORE UPDATE ON public.seo_overrides FOR EACH ROW EXECUTE FUNCTION public.update_seo_overrides_updated_at();


--
-- Name: seo_settings trigger_update_seo_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_seo_settings_updated_at BEFORE UPDATE ON public.seo_settings FOR EACH ROW EXECUTE FUNCTION public.update_seo_settings_updated_at();


--
-- Name: ads_announcements ads_announcements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads_announcements
    ADD CONSTRAINT ads_announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ads ads_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads
    ADD CONSTRAINT ads_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.ad_categories(id) ON DELETE SET NULL;


--
-- Name: ads ads_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ads
    ADD CONSTRAINT ads_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: ai_config ai_config_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_config
    ADD CONSTRAINT ai_config_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: ai_config ai_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_config
    ADD CONSTRAINT ai_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.tenant_admins(id) ON DELETE SET NULL;


--
-- Name: assignment_submissions assignment_submissions_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_submissions
    ADD CONSTRAINT assignment_submissions_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: assignment_submissions assignment_submissions_graded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_submissions
    ADD CONSTRAINT assignment_submissions_graded_by_fkey FOREIGN KEY (graded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: assignment_submissions assignment_submissions_instructor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_submissions
    ADD CONSTRAINT assignment_submissions_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: assignment_submissions assignment_submissions_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignment_submissions
    ADD CONSTRAINT assignment_submissions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: attendance_records attendance_records_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: attendance_records attendance_records_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance_records
    ADD CONSTRAINT attendance_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: certificates certificates_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificates
    ADD CONSTRAINT certificates_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: certificates certificates_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.certificates
    ADD CONSTRAINT certificates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: conversation_participants conversation_participants_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.message_conversations(id) ON DELETE CASCADE;


--
-- Name: course_payments course_payments_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_payments
    ADD CONSTRAINT course_payments_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: course_progress course_progress_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_progress
    ADD CONSTRAINT course_progress_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: course_progress course_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_progress
    ADD CONSTRAINT course_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: courses courses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: credit_redemption_options credit_redemption_options_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_redemption_options
    ADD CONSTRAINT credit_redemption_options_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: credit_redemptions credit_redemptions_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_redemptions
    ADD CONSTRAINT credit_redemptions_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.credit_redemption_options(id) ON DELETE SET NULL;


--
-- Name: credit_redemptions credit_redemptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_redemptions
    ADD CONSTRAINT credit_redemptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: credit_transactions credit_transactions_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: credit_transactions credit_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: discounts discounts_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discounts
    ADD CONSTRAINT discounts_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE SET NULL;


--
-- Name: email_settings email_settings_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_settings
    ADD CONSTRAINT email_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: enrollments enrollments_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: enrollments enrollments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrollments
    ADD CONSTRAINT enrollments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: instructor_assignments instructor_assignments_instructor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_assignments
    ADD CONSTRAINT instructor_assignments_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: instructor_payouts instructor_payouts_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_payouts
    ADD CONSTRAINT instructor_payouts_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE SET NULL;


--
-- Name: instructor_payouts instructor_payouts_instructor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_payouts
    ADD CONSTRAINT instructor_payouts_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: instructor_payouts instructor_payouts_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instructor_payouts
    ADD CONSTRAINT instructor_payouts_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: live_class_invites live_class_invites_live_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_class_invites
    ADD CONSTRAINT live_class_invites_live_class_id_fkey FOREIGN KEY (live_class_id) REFERENCES public.live_classes(id) ON DELETE CASCADE;


--
-- Name: live_class_invites live_class_invites_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_class_invites
    ADD CONSTRAINT live_class_invites_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: live_classes live_classes_instructor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_classes
    ADD CONSTRAINT live_classes_instructor_id_fkey FOREIGN KEY (instructor_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: membership_submissions membership_submissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_submissions
    ADD CONSTRAINT membership_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: message_audit_logs message_audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_audit_logs
    ADD CONSTRAINT message_audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: message_audit_logs message_audit_logs_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_audit_logs
    ADD CONSTRAINT message_audit_logs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.message_conversations(id) ON DELETE SET NULL;


--
-- Name: message_audit_logs message_audit_logs_target_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_audit_logs
    ADD CONSTRAINT message_audit_logs_target_message_id_fkey FOREIGN KEY (target_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: message_audit_logs message_audit_logs_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_audit_logs
    ADD CONSTRAINT message_audit_logs_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: message_blocks message_blocks_blocked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_blocks
    ADD CONSTRAINT message_blocks_blocked_by_fkey FOREIGN KEY (blocked_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: message_blocks message_blocks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_blocks
    ADD CONSTRAINT message_blocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: message_conversations message_conversations_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_conversations
    ADD CONSTRAINT message_conversations_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE SET NULL;


--
-- Name: message_conversations message_conversations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_conversations
    ADD CONSTRAINT message_conversations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: message_conversations message_conversations_muted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_conversations
    ADD CONSTRAINT message_conversations_muted_by_fkey FOREIGN KEY (muted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: message_participants message_participants_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_participants
    ADD CONSTRAINT message_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.message_conversations(id) ON DELETE CASCADE;


--
-- Name: message_participants message_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_participants
    ADD CONSTRAINT message_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: message_receipts message_receipts_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_receipts
    ADD CONSTRAINT message_receipts_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.message_conversations(id) ON DELETE CASCADE;


--
-- Name: message_receipts message_receipts_last_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_receipts
    ADD CONSTRAINT message_receipts_last_message_id_fkey FOREIGN KEY (last_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: message_receipts message_receipts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_receipts
    ADD CONSTRAINT message_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.message_conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE SET NULL;


--
-- Name: messages messages_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: messages messages_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.message_conversations(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_target_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_target_message_id_fkey FOREIGN KEY (target_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payment_gateway_config payment_gateway_config_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_gateway_config
    ADD CONSTRAINT payment_gateway_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.tenant_admins(id) ON DELETE SET NULL;


--
-- Name: payment_refunds payment_refunds_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_refunds
    ADD CONSTRAINT payment_refunds_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.course_payments(id) ON DELETE CASCADE;


--
-- Name: payment_refunds payment_refunds_refunded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_refunds
    ADD CONSTRAINT payment_refunds_refunded_by_fkey FOREIGN KEY (refunded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payment_transactions payment_transactions_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id);


--
-- Name: payment_transactions payment_transactions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_transactions
    ADD CONSTRAINT payment_transactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: provisioning_logs provisioning_logs_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.provisioning_logs
    ADD CONSTRAINT provisioning_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE SET NULL;


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: seo_overrides seo_overrides_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seo_overrides
    ADD CONSTRAINT seo_overrides_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: seo_overrides seo_overrides_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seo_overrides
    ADD CONSTRAINT seo_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: seo_settings seo_settings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seo_settings
    ADD CONSTRAINT seo_settings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: seo_settings seo_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seo_settings
    ADD CONSTRAINT seo_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: static_pages static_pages_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.static_pages
    ADD CONSTRAINT static_pages_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: subscription_plan_prices subscription_plan_prices_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plan_prices
    ADD CONSTRAINT subscription_plan_prices_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id) ON DELETE RESTRICT;


--
-- Name: subscription_refunds subscription_refunds_payment_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_refunds
    ADD CONSTRAINT subscription_refunds_payment_transaction_id_fkey FOREIGN KEY (payment_transaction_id) REFERENCES public.payment_transactions(id) ON DELETE CASCADE;


--
-- Name: subscription_refunds subscription_refunds_refunded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_refunds
    ADD CONSTRAINT subscription_refunds_refunded_by_fkey FOREIGN KEY (refunded_by) REFERENCES public.tenant_admins(id) ON DELETE SET NULL;


--
-- Name: subscription_refunds subscription_refunds_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_refunds
    ADD CONSTRAINT subscription_refunds_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id) ON DELETE RESTRICT;


--
-- Name: subscriptions subscriptions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_admins tenant_admins_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_admins
    ADD CONSTRAINT tenant_admins_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: tenant_user_links tenant_user_links_platform_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_user_links
    ADD CONSTRAINT tenant_user_links_platform_user_id_fkey FOREIGN KEY (platform_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: tenant_user_links tenant_user_links_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenant_user_links
    ADD CONSTRAINT tenant_user_links_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id);


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


