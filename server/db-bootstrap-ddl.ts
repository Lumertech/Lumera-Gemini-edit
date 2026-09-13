export const BOOTSTRAP_DDL = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      phone TEXT NOT NULL DEFAULT '',
      last_login TEXT,
      created_at TEXT NOT NULL,
      tenant_id TEXT DEFAULT '',
      clinic_name TEXT DEFAULT '',
      avatar_url TEXT DEFAULT '',
      whatsapp_verified INTEGER DEFAULT 0,
      hpr_id TEXT DEFAULT '',
      hfr_id TEXT DEFAULT '',
      onboarding_completed INTEGER DEFAULT 0,
      practice_type TEXT DEFAULT 'individual',
      specialty TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cms_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cms_sections (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cms_policies (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta_data_deletion_requests (
      confirmation_code TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      user_ref TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cms_media (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      alt TEXT NOT NULL DEFAULT '',
      mime TEXT NOT NULL DEFAULT '',
      uploaded_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS doctors (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      qualification TEXT NOT NULL DEFAULT '',
      reg_number TEXT NOT NULL DEFAULT '',
      specialty TEXT NOT NULL,
      experience_years INTEGER NOT NULL DEFAULT 0,
      consultation_fee INTEGER NOT NULL DEFAULT 0,
      opd_room TEXT NOT NULL DEFAULT '',
      available_days TEXT NOT NULL DEFAULT '[]',
      opd_timing TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      hpr_id TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Active',
      shift TEXT NOT NULL DEFAULT 'Morning',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      opd_hours TEXT NOT NULL DEFAULT '',
      active_doctors INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Operating'
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      plan_type TEXT NOT NULL,
      monthly_price INTEGER NOT NULL DEFAULT 0,
      auto_renew INTEGER NOT NULL DEFAULT 1,
      started_at TEXT NOT NULL,
      ends_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      uhid TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      age INTEGER NOT NULL DEFAULT 30,
      gender TEXT NOT NULL DEFAULT 'Male',
      phone TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL DEFAULT '',
      blood_group TEXT NOT NULL DEFAULT 'O+',
      allergies TEXT NOT NULL DEFAULT '[]',
      chronic_conditions TEXT NOT NULL DEFAULT '[]',
      emergency_contact TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      last_visit TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      token_number INTEGER NOT NULL,
      patient_id TEXT NOT NULL,
      patient_name TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      uhid TEXT NOT NULL,
      doctor_id TEXT NOT NULL,
      doctor_name TEXT NOT NULL,
      specialty TEXT NOT NULL,
      date TEXT NOT NULL,
      time_slot TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'New Consultation',
      status TEXT NOT NULL DEFAULT 'Waiting',
      source TEXT NOT NULL DEFAULT 'WhatsApp Bot',
      consultation_fee INTEGER NOT NULL DEFAULT 600,
      is_paid INTEGER NOT NULL DEFAULT 1,
      vitals TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prescriptions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT '',
      rx_number TEXT NOT NULL UNIQUE,
      patient_id TEXT NOT NULL,
      patient_name TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      patient_uhid TEXT NOT NULL,
      doctor_id TEXT NOT NULL,
      doctor_name TEXT NOT NULL,
      doctor_specialty TEXT NOT NULL,
      doctor_reg_number TEXT NOT NULL,
      date TEXT NOT NULL,
      diagnosis TEXT NOT NULL,
      icd10_code TEXT,
      chief_complaints TEXT NOT NULL DEFAULT '[]',
      medicines TEXT NOT NULL DEFAULT '[]',
      lab_tests TEXT NOT NULL DEFAULT '[]',
      advice TEXT NOT NULL DEFAULT '[]',
      diet_instructions TEXT,
      follow_up_date TEXT,
      pdf_url TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lab_reports (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      patient_uhid TEXT NOT NULL,
      patient_name TEXT NOT NULL,
      date TEXT NOT NULL,
      lab_name TEXT NOT NULL,
      category TEXT NOT NULL,
      doctor_interpretation TEXT,
      results TEXT NOT NULL DEFAULT '[]',
      pdf_url TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_conversations (
      id TEXT PRIMARY KEY,
      patient_phone TEXT NOT NULL UNIQUE,
      patient_name TEXT NOT NULL,
      patient_id TEXT,
      uhid TEXT,
      handover_mode TEXT NOT NULL DEFAULT 'bot',
      assigned_staff TEXT NOT NULL DEFAULT 'Unassigned',
      tags TEXT NOT NULL DEFAULT '[]',
      preferred_language TEXT NOT NULL DEFAULT 'en',
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_message TEXT NOT NULL DEFAULT '',
      last_message_time TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      sender TEXT NOT NULL,
      staff_name TEXT,
      content TEXT NOT NULL,
      translated_content TEXT,
      detected_language TEXT,
      time_display TEXT NOT NULL,
      buttons TEXT,
      media TEXT,
      audio_url TEXT,
      voice_transcript TEXT,
      status TEXT NOT NULL DEFAULT 'delivered',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_outbound_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      patient_phone TEXT NOT NULL,
      patient_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'delivered',
      details TEXT NOT NULL,
      action_payload TEXT,
      sent_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      specialty TEXT NOT NULL,
      country TEXT NOT NULL,
      timezone TEXT NOT NULL,
      phone TEXT NOT NULL,
      trial_ends_at TEXT NOT NULL,
      ai_scribe_minutes_limit INTEGER NOT NULL DEFAULT 500,
      ai_scribe_minutes_used INTEGER NOT NULL DEFAULT 0,
      active_status INTEGER NOT NULL DEFAULT 1,
      hfr_id TEXT NOT NULL DEFAULT '',
      waba_id TEXT DEFAULT '',
      phone_number_id TEXT DEFAULT '',
      meta_access_token TEXT DEFAULT '',
      meta_token_expires_at TEXT DEFAULT '',
      meta_waba_name TEXT DEFAULT '',
      meta_quality_rating TEXT DEFAULT 'GREEN',
      meta_onboarding_status TEXT DEFAULT 'pending',
      tagline TEXT DEFAULT '',
      address TEXT DEFAULT '',
      city TEXT DEFAULT '',
      email TEXT DEFAULT '',
      website TEXT DEFAULT '',
      gstin TEXT DEFAULT '',
      reg_id TEXT DEFAULT '',
      upi_id TEXT DEFAULT '',
      whatsapp_number TEXT DEFAULT '',
      seal_text TEXT DEFAULT '',
      footer_disclaimer TEXT DEFAULT '',
      practice_settings TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      invoice_number TEXT NOT NULL,
      appointment_id TEXT NOT NULL DEFAULT '',
      patient_id TEXT NOT NULL DEFAULT '',
      patient_name TEXT NOT NULL DEFAULT '',
      patient_phone TEXT NOT NULL DEFAULT '',
      patient_uhid TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      subtotal INTEGER NOT NULL DEFAULT 0,
      discount_amount INTEGER NOT NULL DEFAULT 0,
      gstin TEXT NOT NULL DEFAULT '',
      gst_percent REAL NOT NULL DEFAULT 0,
      tax_amount INTEGER NOT NULL DEFAULT 0,
      total_amount INTEGER NOT NULL DEFAULT 0,
      paid_amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Unpaid',
      payment_mode TEXT NOT NULL DEFAULT '',
      payment_ref TEXT NOT NULL DEFAULT '',
      razorpay_order_id TEXT NOT NULL DEFAULT '',
      razorpay_payment_id TEXT NOT NULL DEFAULT '',
      razorpay_payment_link_id TEXT NOT NULL DEFAULT '',
      pay_link TEXT NOT NULL DEFAULT '',
      upi_id TEXT NOT NULL DEFAULT '',
      issued_by TEXT NOT NULL DEFAULT '',
      receipt_whatsapp_status TEXT NOT NULL DEFAULT 'unsent',
      receipt_whatsapp_channel TEXT NOT NULL DEFAULT '',
      receipt_whatsapp_message_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      paid_at TEXT,
      UNIQUE (tenant_id, invoice_number)
    );

    CREATE TABLE IF NOT EXISTS meta_templates (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      waba_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      language TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      components TEXT NOT NULL DEFAULT '[]',
      meta_template_id TEXT,
      rejection_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dhis_transactions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      claims_count INTEGER NOT NULL DEFAULT 0,
      claims_threshold INTEGER NOT NULL DEFAULT 100,
      month_year TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS otp_verifications (
      id TEXT PRIMARY KEY,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      otp TEXT NOT NULL,
      purpose TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      verified_at TEXT
    );

    -- NHA sandbox: tenant-scoped ABDM consent artefacts.
    CREATE TABLE IF NOT EXISTS abdm_consent_artefacts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      consent_id TEXT NOT NULL,
      artefact_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, consent_id)
    );

    CREATE TABLE IF NOT EXISTS plans (
      code TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      price_copy TEXT NOT NULL DEFAULT '',
      monthly_price INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tenant_subscriptions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL UNIQUE,
      plan_code TEXT NOT NULL,
      status TEXT NOT NULL,
      billing_source TEXT NOT NULL DEFAULT 'manual',
      started_at TEXT NOT NULL,
      ends_at TEXT,
      renews_at TEXT,
      monthly_price INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
`;
