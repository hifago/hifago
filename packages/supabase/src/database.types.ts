export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_table: string
          id: string
          note: string | null
        }
        Insert: {
          action: string
          actor_id: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_table: string
          id?: string
          note?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_table?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_blocks: {
        Row: {
          created_at: string
          end_date: string
          establishment_id: string
          id: string
          source_order_line_id: string
          start_date: string
        }
        Insert: {
          created_at?: string
          end_date: string
          establishment_id: string
          id?: string
          source_order_line_id: string
          start_date: string
        }
        Update: {
          created_at?: string
          end_date?: string
          establishment_id?: string
          id?: string
          source_order_line_id?: string
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_blocks_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_blocks_source_order_line_id_fkey"
            columns: ["source_order_line_id"]
            isOneToOne: false
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_items: {
        Row: {
          account_id: string
          created_at: string
          date: string
          end_date: string | null
          id: string
          product_id: string
          qty: number
          slot_start_time: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          date: string
          end_date?: string | null
          id?: string
          product_id: string
          qty: number
          slot_start_time?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          date?: string
          end_date?: string | null
          id?: string
          product_id?: string
          qty?: number
          slot_start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          account_id: string
          attribution_code: string | null
          attribution_source: string | null
          created_at: string
        }
        Insert: {
          account_id: string
          attribution_code?: string | null
          attribution_source?: string | null
          created_at?: string
        }
        Update: {
          account_id?: string
          attribution_code?: string | null
          attribution_source?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_amenities: {
        Row: {
          category_key: string
          created_at: string
          id: string
          label: Json
          often_paid: boolean
          recommended_level: string
          slug: string
          sort_order: number
        }
        Insert: {
          category_key: string
          created_at?: string
          id?: string
          label: Json
          often_paid?: boolean
          recommended_level?: string
          slug: string
          sort_order?: number
        }
        Update: {
          category_key?: string
          created_at?: string
          id?: string
          label?: Json
          often_paid?: boolean
          recommended_level?: string
          slug?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "catalog_amenities_category_key_fkey"
            columns: ["category_key"]
            isOneToOne: false
            referencedRelation: "catalog_amenity_categories"
            referencedColumns: ["key"]
          },
        ]
      }
      catalog_amenity_categories: {
        Row: {
          created_at: string
          key: string
          label: Json
          sort_order: number
        }
        Insert: {
          created_at?: string
          key: string
          label: Json
          sort_order?: number
        }
        Update: {
          created_at?: string
          key?: string
          label?: Json
          sort_order?: number
        }
        Relationships: []
      }
      catalog_tags: {
        Row: {
          created_at: string
          description: Json | null
          id: string
          image_path: string | null
          label: Json
          slug: string
        }
        Insert: {
          created_at?: string
          description?: Json | null
          id?: string
          image_path?: string | null
          label: Json
          slug: string
        }
        Update: {
          created_at?: string
          description?: Json | null
          id?: string
          image_path?: string | null
          label?: Json
          slug?: string
        }
        Relationships: []
      }
      comm_campaign_targets: {
        Row: {
          account_id: string
          campaign_id: string
          id: string
          sent_at: string | null
          status: string
        }
        Insert: {
          account_id: string
          campaign_id: string
          id?: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          account_id?: string
          campaign_id?: string
          id?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "comm_campaign_targets_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comm_campaign_targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "comm_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      comm_campaigns: {
        Row: {
          audience: string
          channel: string
          created_at: string
          created_by: string
          id: string
          message_template: string
          status: string
        }
        Insert: {
          audience: string
          channel: string
          created_at?: string
          created_by: string
          id?: string
          message_template: string
          status?: string
        }
        Update: {
          audience?: string
          channel?: string
          created_at?: string
          created_by?: string
          id?: string
          message_template?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "comm_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      establishment_amenity_assignments: {
        Row: {
          amenity_id: string
          created_at: string
          establishment_id: string
        }
        Insert: {
          amenity_id: string
          created_at?: string
          establishment_id: string
        }
        Update: {
          amenity_id?: string
          created_at?: string
          establishment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "establishment_amenity_assignments_amenity_id_fkey"
            columns: ["amenity_id"]
            isOneToOne: false
            referencedRelation: "catalog_amenities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "establishment_amenity_assignments_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      establishment_media: {
        Row: {
          created_at: string
          establishment_id: string
          id: string
          sort: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          establishment_id: string
          id?: string
          sort?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          establishment_id?: string
          id?: string
          sort?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "establishment_media_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      establishment_payout_accounts: {
        Row: {
          bank: Json
          establishment_id: string
          updated_at: string
        }
        Insert: {
          bank: Json
          establishment_id: string
          updated_at?: string
        }
        Update: {
          bank?: Json
          establishment_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "establishment_payout_accounts_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: true
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      establishment_proposals: {
        Row: {
          created_at: string
          establishment_id: string | null
          id: string
          kind: string
          partner_id: string
          payload: Json
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_by: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          establishment_id?: string | null
          id?: string
          kind: string
          partner_id: string
          payload: Json
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          establishment_id?: string | null
          id?: string
          kind?: string
          partner_id?: string
          payload?: Json
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "establishment_proposals_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "establishment_proposals_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "establishment_proposals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "establishment_proposals_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      establishment_tag_assignments: {
        Row: {
          created_at: string
          establishment_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          establishment_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          establishment_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "establishment_tag_assignments_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "establishment_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "catalog_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      establishments: {
        Row: {
          address: string | null
          check_in_time: string | null
          check_out_time: string | null
          contact_phone: string | null
          created_at: string
          description: Json | null
          id: string
          lat: number | null
          lobby_api_token: string | null
          lobby_connector_active: boolean
          lobby_has_token: boolean | null
          lobby_last_synced_at: string | null
          lon: number | null
          mode: string | null
          name: Json
          operated_directly: boolean
          partner_id: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          check_in_time?: string | null
          check_out_time?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: Json | null
          id?: string
          lat?: number | null
          lobby_api_token?: string | null
          lobby_connector_active?: boolean
          lobby_has_token?: boolean | null
          lobby_last_synced_at?: string | null
          lon?: number | null
          mode?: string | null
          name: Json
          operated_directly?: boolean
          partner_id: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          check_in_time?: string | null
          check_out_time?: string | null
          contact_phone?: string | null
          created_at?: string
          description?: Json | null
          id?: string
          lat?: number | null
          lobby_api_token?: string | null
          lobby_connector_active?: boolean
          lobby_has_token?: boolean | null
          lobby_last_synced_at?: string | null
          lon?: number | null
          mode?: string | null
          name?: Json
          operated_directly?: boolean
          partner_id?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "establishments_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      job_heartbeats: {
        Row: {
          alerted_at: string | null
          created_at: string
          job_name: string
          last_error: string | null
          last_ok_at: string | null
          last_run_at: string | null
          stats: Json
        }
        Insert: {
          alerted_at?: string | null
          created_at?: string
          job_name: string
          last_error?: string | null
          last_ok_at?: string | null
          last_run_at?: string | null
          stats?: Json
        }
        Update: {
          alerted_at?: string | null
          created_at?: string
          job_name?: string
          last_error?: string | null
          last_ok_at?: string | null
          last_run_at?: string | null
          stats?: Json
        }
        Relationships: []
      }
      ledger_entries: {
        Row: {
          amount_cop: number
          beneficiary_type: string
          comprobante_path: string | null
          created_at: string
          entry_type: string
          establishment_id: string | null
          id: string
          note: string | null
          order_line_id: string
          paid_at: string | null
          referrer_partner_id: string | null
          status: string
        }
        Insert: {
          amount_cop: number
          beneficiary_type: string
          comprobante_path?: string | null
          created_at?: string
          entry_type: string
          establishment_id?: string | null
          id?: string
          note?: string | null
          order_line_id: string
          paid_at?: string | null
          referrer_partner_id?: string | null
          status?: string
        }
        Update: {
          amount_cop?: number
          beneficiary_type?: string
          comprobante_path?: string | null
          created_at?: string
          entry_type?: string
          establishment_id?: string | null
          id?: string
          note?: string | null
          order_line_id?: string
          paid_at?: string | null
          referrer_partner_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_referrer_partner_id_fkey"
            columns: ["referrer_partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_emails: {
        Row: {
          attempts: number
          body_html: string
          created_at: string
          event_type: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          provider_message_id: string | null
          recipient_account_id: string | null
          recipient_email: string
          related_id: string | null
          related_table: string | null
          sent_at: string | null
          status: string
          subject: string
        }
        Insert: {
          attempts?: number
          body_html: string
          created_at?: string
          event_type: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          provider_message_id?: string | null
          recipient_account_id?: string | null
          recipient_email: string
          related_id?: string | null
          related_table?: string | null
          sent_at?: string | null
          status?: string
          subject: string
        }
        Update: {
          attempts?: number
          body_html?: string
          created_at?: string
          event_type?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          provider_message_id?: string | null
          recipient_account_id?: string | null
          recipient_email?: string
          related_id?: string | null
          related_table?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_emails_recipient_account_id_fkey"
            columns: ["recipient_account_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      order_lines: {
        Row: {
          account_id: string
          acompte_cop: number
          acompte_pct: number
          app_commission_cop: number
          app_pct: number
          commission_case: string
          created_at: string
          date: string
          end_date: string | null
          holder_email: string | null
          holder_name: string
          holder_phone: string | null
          id: string
          order_id: string
          pms_booking_id: string | null
          pms_last_polled_at: string | null
          price_cop: number
          product_id: string
          qty: number
          referrer_commission_cop: number
          referrer_partner_id: string | null
          referrer_pct: number
          replaces_order_line_id: string | null
          slot_start_time: string | null
          status: string
          total_cop: number
        }
        Insert: {
          account_id: string
          acompte_cop: number
          acompte_pct: number
          app_commission_cop: number
          app_pct: number
          commission_case: string
          created_at?: string
          date: string
          end_date?: string | null
          holder_email?: string | null
          holder_name: string
          holder_phone?: string | null
          id?: string
          order_id: string
          pms_booking_id?: string | null
          pms_last_polled_at?: string | null
          price_cop: number
          product_id: string
          qty: number
          referrer_commission_cop: number
          referrer_partner_id?: string | null
          referrer_pct: number
          replaces_order_line_id?: string | null
          slot_start_time?: string | null
          status?: string
          total_cop: number
        }
        Update: {
          account_id?: string
          acompte_cop?: number
          acompte_pct?: number
          app_commission_cop?: number
          app_pct?: number
          commission_case?: string
          created_at?: string
          date?: string
          end_date?: string | null
          holder_email?: string | null
          holder_name?: string
          holder_phone?: string | null
          id?: string
          order_id?: string
          pms_booking_id?: string | null
          pms_last_polled_at?: string | null
          price_cop?: number
          product_id?: string
          qty?: number
          referrer_commission_cop?: number
          referrer_partner_id?: string | null
          referrer_pct?: number
          replaces_order_line_id?: string | null
          slot_start_time?: string | null
          status?: string
          total_cop?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_referrer_partner_id_fkey"
            columns: ["referrer_partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_lines_replaces_order_line_id_fkey"
            columns: ["replaces_order_line_id"]
            isOneToOne: false
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          access_token: string
          account_id: string
          attribution_code: string | null
          attribution_source: string | null
          created_at: string
          holder_email: string
          holder_name: string
          holder_phone: string | null
          id: string
          marketing_consent: boolean
          payment_status: string
          pms_reserve_claimed_at: string | null
          reconcile_checked_at: string | null
          reconcile_claimed_at: string | null
          reference: string
          referrer_partner_id: string | null
          status: string
        }
        Insert: {
          access_token?: string
          account_id: string
          attribution_code?: string | null
          attribution_source?: string | null
          created_at?: string
          holder_email: string
          holder_name: string
          holder_phone?: string | null
          id?: string
          marketing_consent?: boolean
          payment_status?: string
          pms_reserve_claimed_at?: string | null
          reconcile_checked_at?: string | null
          reconcile_claimed_at?: string | null
          reference?: string
          referrer_partner_id?: string | null
          status?: string
        }
        Update: {
          access_token?: string
          account_id?: string
          attribution_code?: string | null
          attribution_source?: string | null
          created_at?: string
          holder_email?: string
          holder_name?: string
          holder_phone?: string | null
          id?: string
          marketing_consent?: boolean
          payment_status?: string
          pms_reserve_claimed_at?: string | null
          reconcile_checked_at?: string | null
          reconcile_claimed_at?: string | null
          reference?: string
          referrer_partner_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_attribution_code_fkey"
            columns: ["attribution_code"]
            isOneToOne: false
            referencedRelation: "partner_codes"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "orders_referrer_partner_id_fkey"
            columns: ["referrer_partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_accounts: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          partner_id: string | null
          phone: string | null
          saved_attribution_code: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          partner_id?: string | null
          phone?: string | null
          saved_attribution_code?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          partner_id?: string | null
          phone?: string | null
          saved_attribution_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_accounts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_accounts_saved_attribution_code_fkey"
            columns: ["saved_attribution_code"]
            isOneToOne: false
            referencedRelation: "partner_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      partner_capabilities: {
        Row: {
          account_id: string | null
          created_at: string
          establishment_id: string | null
          id: string
          partner_id: string | null
          role: string
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          establishment_id?: string | null
          id?: string
          partner_id?: string | null
          role: string
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          establishment_id?: string | null
          id?: string
          partner_id?: string | null
          role?: string
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_capabilities_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_capabilities_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_capabilities_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_codes: {
        Row: {
          active: boolean
          attribution: Json | null
          code: string
          commission_enabled: boolean
          created_at: string
          partner_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          attribution?: Json | null
          code: string
          commission_enabled?: boolean
          created_at?: string
          partner_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          attribution?: Json | null
          code?: string
          commission_enabled?: boolean
          created_at?: string
          partner_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_codes_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_crm_profile: {
        Row: {
          address: string | null
          bank: Json | null
          barrio: string | null
          commercial_status: string
          created_at: string
          last_contact_at: string | null
          last_payment_at: string | null
          lat: number | null
          lon: number | null
          notes: string | null
          partner_id: string
          rdv_at: string | null
          tags: string[]
          updated_at: string
        }
        Insert: {
          address?: string | null
          bank?: Json | null
          barrio?: string | null
          commercial_status?: string
          created_at?: string
          last_contact_at?: string | null
          last_payment_at?: string | null
          lat?: number | null
          lon?: number | null
          notes?: string | null
          partner_id: string
          rdv_at?: string | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          address?: string | null
          bank?: Json | null
          barrio?: string | null
          commercial_status?: string
          created_at?: string
          last_contact_at?: string | null
          last_payment_at?: string | null
          lat?: number | null
          lon?: number | null
          notes?: string | null
          partner_id?: string
          rdv_at?: string | null
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_crm_profile_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: true
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_invitations: {
        Row: {
          consumed_at: string | null
          consumed_by_account_id: string | null
          created_at: string
          created_by: string | null
          email: string | null
          expires_at: string
          id: string
          onboarding_path: string
          partner_hint: Json | null
          partner_id: string | null
          promo_code: string
          status: string
          token_hash: string
        }
        Insert: {
          consumed_at?: string | null
          consumed_by_account_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          expires_at: string
          id?: string
          onboarding_path: string
          partner_hint?: Json | null
          partner_id?: string | null
          promo_code: string
          status?: string
          token_hash: string
        }
        Update: {
          consumed_at?: string | null
          consumed_by_account_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          expires_at?: string
          id?: string
          onboarding_path?: string
          partner_hint?: Json | null
          partner_id?: string | null
          promo_code?: string
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_invitations_consumed_by_account_id_fkey"
            columns: ["consumed_by_account_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_invitations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_invitations_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_invitations_promo_code_fkey"
            columns: ["promo_code"]
            isOneToOne: false
            referencedRelation: "partner_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      partner_offboarding: {
        Row: {
          capability_revoked_at: string | null
          capability_revoked_by: string | null
          created_at: string
          created_by: string
          id: string
          partner_id: string
          payments_settled_at: string | null
          payments_settled_by: string | null
          payments_settled_note: string | null
          unpublished_at: string | null
          unpublished_by: string | null
        }
        Insert: {
          capability_revoked_at?: string | null
          capability_revoked_by?: string | null
          created_at?: string
          created_by: string
          id?: string
          partner_id: string
          payments_settled_at?: string | null
          payments_settled_by?: string | null
          payments_settled_note?: string | null
          unpublished_at?: string | null
          unpublished_by?: string | null
        }
        Update: {
          capability_revoked_at?: string | null
          capability_revoked_by?: string | null
          created_at?: string
          created_by?: string
          id?: string
          partner_id?: string
          payments_settled_at?: string | null
          payments_settled_by?: string | null
          payments_settled_note?: string | null
          unpublished_at?: string | null
          unpublished_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_offboarding_capability_revoked_by_fkey"
            columns: ["capability_revoked_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_offboarding_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_offboarding_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_offboarding_payments_settled_by_fkey"
            columns: ["payments_settled_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_offboarding_unpublished_by_fkey"
            columns: ["unpublished_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_payout_accounts: {
        Row: {
          mercadopago_account: string
          partner_id: string
          updated_at: string
        }
        Insert: {
          mercadopago_account: string
          partner_id: string
          updated_at?: string
        }
        Update: {
          mercadopago_account?: string
          partner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_payout_accounts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: true
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          created_at: string
          display_name: string
          email: string | null
          id: string
          identification_number: string | null
          identification_type: string | null
          legal_name: string | null
          partner_city: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          email?: string | null
          id?: string
          identification_number?: string | null
          identification_type?: string | null
          legal_name?: string | null
          partner_city?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          identification_number?: string | null
          identification_type?: string | null
          legal_name?: string | null
          partner_city?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payment_reconciliation_entries: {
        Row: {
          attempts: number
          created_at: string
          external_reference: string | null
          failure_reason: string
          id: string
          kind: string
          last_attempt_at: string | null
          mp_payment_id: string | null
          payment_id: string | null
          raw_event: Json
          reason_code: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          external_reference?: string | null
          failure_reason: string
          id?: string
          kind?: string
          last_attempt_at?: string | null
          mp_payment_id?: string | null
          payment_id?: string | null
          raw_event: Json
          reason_code?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          external_reference?: string | null
          failure_reason?: string
          id?: string
          kind?: string
          last_attempt_at?: string | null
          mp_payment_id?: string | null
          payment_id?: string | null
          raw_event?: Json
          reason_code?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_reconciliation_entries_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_reconciliation_entries_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_refunds: {
        Row: {
          amount_cop: number
          attempts: number
          created_at: string
          entry_id: string
          id: string
          last_error: string | null
          mp_payment_id: string
          mp_refund_id: string | null
          next_attempt_at: string | null
          note: string | null
          payment_id: string | null
          raw_response: Json | null
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_cop: number
          attempts?: number
          created_at?: string
          entry_id: string
          id?: string
          last_error?: string | null
          mp_payment_id: string
          mp_refund_id?: string | null
          next_attempt_at?: string | null
          note?: string | null
          payment_id?: string | null
          raw_response?: Json | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cop?: number
          attempts?: number
          created_at?: string
          entry_id?: string
          id?: string
          last_error?: string | null
          mp_payment_id?: string
          mp_refund_id?: string | null
          next_attempt_at?: string | null
          note?: string | null
          payment_id?: string | null
          raw_response?: Json | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_refunds_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "payment_reconciliation_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_refunds_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cop: number
          created_at: string
          id: string
          mp_cancel_attempts: number
          mp_collector_id: string | null
          mp_last_checked_at: string | null
          mp_last_status: string | null
          mp_payment_id: string | null
          mp_preference_id: string | null
          order_id: string
          payer_email: string | null
          provider: string
          raw_last_event: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_cop: number
          created_at?: string
          id?: string
          mp_cancel_attempts?: number
          mp_collector_id?: string | null
          mp_last_checked_at?: string | null
          mp_last_status?: string | null
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          order_id: string
          payer_email?: string | null
          provider?: string
          raw_last_event?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cop?: number
          created_at?: string
          id?: string
          mp_cancel_attempts?: number
          mp_collector_id?: string | null
          mp_last_checked_at?: string | null
          mp_last_status?: string | null
          mp_payment_id?: string | null
          mp_preference_id?: string | null
          order_id?: string
          payer_email?: string | null
          provider?: string
          raw_last_event?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      pms_availability_mirror: {
        Row: {
          available_units: number
          date: string
          establishment_id: string
          lead_days: number | null
          lobby_category_id: number
          max_stay: number | null
          min_stay: number | null
          synced_at: string
        }
        Insert: {
          available_units: number
          date: string
          establishment_id: string
          lead_days?: number | null
          lobby_category_id: number
          max_stay?: number | null
          min_stay?: number | null
          synced_at?: string
        }
        Update: {
          available_units?: number
          date?: string
          establishment_id?: string
          lead_days?: number | null
          lobby_category_id?: number
          max_stay?: number | null
          min_stay?: number | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pms_availability_mirror_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      pms_cancellation_queue: {
        Row: {
          attempts: number
          created_at: string
          establishment_id: string
          hifago_status: string | null
          id: string
          last_error: string | null
          lobby_status_code: number | null
          pms_booking_id: string
          processed_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          establishment_id: string
          hifago_status?: string | null
          id?: string
          last_error?: string | null
          lobby_status_code?: number | null
          pms_booking_id: string
          processed_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          establishment_id?: string
          hifago_status?: string | null
          id?: string
          last_error?: string | null
          lobby_status_code?: number | null
          pms_booking_id?: string
          processed_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pms_cancellation_queue_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      pms_reconciliation_entries: {
        Row: {
          attempts: number
          created_at: string
          detail: string | null
          id: string
          last_attempt_at: string | null
          order_line_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          detail?: string | null
          id?: string
          last_attempt_at?: string | null
          order_line_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          detail?: string | null
          id?: string
          last_attempt_at?: string | null
          order_line_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pms_reconciliation_entries_order_line_id_fkey"
            columns: ["order_line_id"]
            isOneToOne: false
            referencedRelation: "order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pms_reconciliation_entries_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      pms_sync_state: {
        Row: {
          attempts: number
          claimed_at: string | null
          establishment_id: string
          invalidated_at: string | null
          last_error: string | null
          month: string
          next_attempt_at: string | null
          synced_at: string | null
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          establishment_id: string
          invalidated_at?: string | null
          last_error?: string | null
          month: string
          next_attempt_at?: string | null
          synced_at?: string | null
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          establishment_id?: string
          invalidated_at?: string | null
          last_error?: string | null
          month?: string
          next_attempt_at?: string | null
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pms_sync_state_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      product_amenity_assignments: {
        Row: {
          amenity_id: string
          created_at: string
          product_id: string
        }
        Insert: {
          amenity_id: string
          created_at?: string
          product_id: string
        }
        Update: {
          amenity_id?: string
          created_at?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_amenity_assignments_amenity_id_fkey"
            columns: ["amenity_id"]
            isOneToOne: false
            referencedRelation: "catalog_amenities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_amenity_assignments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_availability: {
        Row: {
          booked: number
          capacity: number
          date: string
          id: string
          product_id: string
        }
        Insert: {
          booked?: number
          capacity: number
          date: string
          id?: string
          product_id: string
        }
        Update: {
          booked?: number
          capacity?: number
          date?: string
          id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_availability_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_calendar: {
        Row: {
          date: string
          open: boolean
          product_id: string
        }
        Insert: {
          date: string
          open?: boolean
          product_id: string
        }
        Update: {
          date?: string
          open?: boolean
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_calendar_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_date_rates: {
        Row: {
          date: string
          note: string | null
          price_cop: number
          product_id: string
        }
        Insert: {
          date: string
          note?: string | null
          price_cop: number
          product_id: string
        }
        Update: {
          date?: string
          note?: string | null
          price_cop?: number
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_date_rates_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_media: {
        Row: {
          created_at: string
          id: string
          product_id: string
          sort: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          sort?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          sort?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_media_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_proposals: {
        Row: {
          created_at: string
          establishment_id: string | null
          id: string
          kind: string
          partner_id: string
          payload: Json
          product_id: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_by: string
          type: string | null
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          establishment_id?: string | null
          id?: string
          kind?: string
          partner_id: string
          payload: Json
          product_id?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by: string
          type?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          establishment_id?: string | null
          id?: string
          kind?: string
          partner_id?: string
          payload?: Json
          product_id?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_by?: string
          type?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_proposals_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_proposals_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_proposals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_proposals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_proposals_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      product_slot_availability: {
        Row: {
          booked: number
          capacity: number
          id: string
          product_id: string
          slot_date: string
          slot_duration_minutes: number
          slot_start_time: string
        }
        Insert: {
          booked?: number
          capacity: number
          id?: string
          product_id: string
          slot_date: string
          slot_duration_minutes: number
          slot_start_time: string
        }
        Update: {
          booked?: number
          capacity?: number
          id?: string
          product_id?: string
          slot_date?: string
          slot_duration_minutes?: number
          slot_start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_slot_availability_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_slot_rules: {
        Row: {
          capacity: number
          created_at: string
          end_time: string
          id: string
          product_id: string
          slot_duration_minutes: number
          start_time: string
          weekdays: number[]
        }
        Insert: {
          capacity: number
          created_at?: string
          end_time: string
          id?: string
          product_id: string
          slot_duration_minutes: number
          start_time: string
          weekdays: number[]
        }
        Update: {
          capacity?: number
          created_at?: string
          end_time?: string
          id?: string
          product_id?: string
          slot_duration_minutes?: number
          start_time?: string
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "product_slot_rules_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_tag_assignments: {
        Row: {
          created_at: string
          product_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          product_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          product_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_tag_assignments_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "catalog_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          acompte_pct: number
          address: string | null
          calendar_default_open: boolean
          capacity: number | null
          category: string | null
          check_in_time: string | null
          check_out_time: string | null
          created_at: string
          default_capacity: number | null
          description: Json | null
          duration_days: number | null
          duration_minutes: number | null
          establishment_id: string
          evento_capacity_mode: string | null
          evento_occupies_resource: boolean
          evento_payment_mode: string | null
          external_booking_url: string | null
          group_discount_pct: number | null
          group_discount_threshold_qty: number | null
          id: string
          is_free: boolean
          lat: number | null
          lobby_category_id: number | null
          lobby_product_id: number | null
          lodging_kind: string | null
          lon: number | null
          max_qty: number | null
          max_units: number | null
          min_qty: number | null
          name: Json
          occurrence_date: string | null
          occurrence_type: string | null
          online_bookable: boolean
          partner_id: string
          price_cop: number | null
          price_label: string | null
          price_tiers: Json | null
          program: Json | null
          qty_unit: string
          recurrence_end_count: number | null
          recurrence_end_date: string | null
          recurrence_frequency_days: number | null
          referral_pct: number
          schedule: string
          sellable: boolean
          slug: string
          sort: number | null
          start_time: string | null
          stay_rates: Json | null
          transport_arrival_address: string | null
          transport_arrival_lat: number | null
          transport_arrival_lon: number | null
          transport_contact_phone: string | null
          transport_departure_address: string | null
          transport_departure_lat: number | null
          transport_departure_lon: number | null
          transport_first_departure_time: string | null
          transport_last_departure_time: string | null
          transport_seats_per_departure: number | null
          type: string
          unit: string | null
          unit_count: number | null
          updated_at: string
        }
        Insert: {
          acompte_pct?: number
          address?: string | null
          calendar_default_open?: boolean
          capacity?: number | null
          category?: string | null
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          default_capacity?: number | null
          description?: Json | null
          duration_days?: number | null
          duration_minutes?: number | null
          establishment_id: string
          evento_capacity_mode?: string | null
          evento_occupies_resource?: boolean
          evento_payment_mode?: string | null
          external_booking_url?: string | null
          group_discount_pct?: number | null
          group_discount_threshold_qty?: number | null
          id?: string
          is_free?: boolean
          lat?: number | null
          lobby_category_id?: number | null
          lobby_product_id?: number | null
          lodging_kind?: string | null
          lon?: number | null
          max_qty?: number | null
          max_units?: number | null
          min_qty?: number | null
          name: Json
          occurrence_date?: string | null
          occurrence_type?: string | null
          online_bookable?: boolean
          partner_id: string
          price_cop?: number | null
          price_label?: string | null
          price_tiers?: Json | null
          program?: Json | null
          qty_unit?: string
          recurrence_end_count?: number | null
          recurrence_end_date?: string | null
          recurrence_frequency_days?: number | null
          referral_pct?: number
          schedule?: string
          sellable?: boolean
          slug: string
          sort?: number | null
          start_time?: string | null
          stay_rates?: Json | null
          transport_arrival_address?: string | null
          transport_arrival_lat?: number | null
          transport_arrival_lon?: number | null
          transport_contact_phone?: string | null
          transport_departure_address?: string | null
          transport_departure_lat?: number | null
          transport_departure_lon?: number | null
          transport_first_departure_time?: string | null
          transport_last_departure_time?: string | null
          transport_seats_per_departure?: number | null
          type: string
          unit?: string | null
          unit_count?: number | null
          updated_at?: string
        }
        Update: {
          acompte_pct?: number
          address?: string | null
          calendar_default_open?: boolean
          capacity?: number | null
          category?: string | null
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string
          default_capacity?: number | null
          description?: Json | null
          duration_days?: number | null
          duration_minutes?: number | null
          establishment_id?: string
          evento_capacity_mode?: string | null
          evento_occupies_resource?: boolean
          evento_payment_mode?: string | null
          external_booking_url?: string | null
          group_discount_pct?: number | null
          group_discount_threshold_qty?: number | null
          id?: string
          is_free?: boolean
          lat?: number | null
          lobby_category_id?: number | null
          lobby_product_id?: number | null
          lodging_kind?: string | null
          lon?: number | null
          max_qty?: number | null
          max_units?: number | null
          min_qty?: number | null
          name?: Json
          occurrence_date?: string | null
          occurrence_type?: string | null
          online_bookable?: boolean
          partner_id?: string
          price_cop?: number | null
          price_label?: string | null
          price_tiers?: Json | null
          program?: Json | null
          qty_unit?: string
          recurrence_end_count?: number | null
          recurrence_end_date?: string | null
          recurrence_frequency_days?: number | null
          referral_pct?: number
          schedule?: string
          sellable?: boolean
          slug?: string
          sort?: number | null
          start_time?: string | null
          stay_rates?: Json | null
          transport_arrival_address?: string | null
          transport_arrival_lat?: number | null
          transport_arrival_lon?: number | null
          transport_contact_phone?: string | null
          transport_departure_address?: string | null
          transport_departure_lat?: number | null
          transport_departure_lon?: number | null
          transport_first_departure_time?: string | null
          transport_last_departure_time?: string | null
          transport_seats_per_departure?: number | null
          type?: string
          unit?: string | null
          unit_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_resource_calendar: {
        Row: {
          booked: number
          capacity: number
          establishment_id: string
          slot_date: string
        }
        Insert: {
          booked?: number
          capacity: number
          establishment_id: string
          slot_date: string
        }
        Update: {
          booked?: number
          capacity?: number
          establishment_id?: string
          slot_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_resource_calendar_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "establishments"
            referencedColumns: ["id"]
          },
        ]
      }
      role_agreements: {
        Row: {
          accepted_at: string
          account_id: string
          created_at: string
          document_hash: string | null
          document_version: string
          explicit_consent: boolean
          id: string
          ip: string | null
          partner_id: string
          revoked_at: string | null
          role: string
          signer_name: string
          user_agent: string | null
        }
        Insert: {
          accepted_at?: string
          account_id: string
          created_at?: string
          document_hash?: string | null
          document_version: string
          explicit_consent?: boolean
          id?: string
          ip?: string | null
          partner_id: string
          revoked_at?: string | null
          role: string
          signer_name: string
          user_agent?: string | null
        }
        Update: {
          accepted_at?: string
          account_id?: string
          created_at?: string
          document_hash?: string | null
          document_version?: string
          explicit_consent?: boolean
          id?: string
          ip?: string | null
          partner_id?: string
          revoked_at?: string | null
          role?: string
          signer_name?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_agreements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "partner_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_agreements_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_catalog_media: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_sort?: number
          p_storage_path: string
        }
        Returns: string
      }
      admin_client_order_lines: {
        Args: { p_order_ids: string[] }
        Returns: {
          date: string
          end_date: string
          establishment_name: Json
          id: string
          order_id: string
          product_name: Json
          qty: number
          status: string
          total_cop: number
        }[]
      }
      admin_dashboard_daily_series: {
        Args: { p_since: string }
        Returns: {
          app_commission_cop: number
          date: string
          referrer_commission_cop: number
          sales_cop: number
        }[]
      }
      admin_dashboard_referrer_commissions: {
        Args: never
        Returns: {
          referrer_commission_cop: number
          referrer_partner_id: string
        }[]
      }
      admin_dashboard_top_partners: {
        Args: { p_limit?: number }
        Returns: {
          partner_display_name: string
          partner_id: string
          total_cop: number
        }[]
      }
      admin_dashboard_totals: {
        Args: { p_today: string }
        Returns: {
          app_commission_cop: number
          pending_count: number
          referrer_commission_cop: number
          revenue_cop: number
        }[]
      }
      admin_ledger_entries_list: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_establishment_id?: string
          p_limit?: number
          p_offset?: number
          p_referrer_partner_id?: string
          p_sort_desc?: boolean
          p_sort_key?: string
          p_status?: string
          p_type?: string
        }
        Returns: {
          amount_cop: number
          date: string
          establishment_name: Json
          id: string
          product_type: string
          referrer_display_name: string
          status: string
          total_count: number
        }[]
      }
      admin_order_line_ledger: {
        Args: { p_order_id: string }
        Returns: {
          acompte_cop: number
          app_commission_cop: number
          commission_case: string
          date: string
          id: string
          product_name: Json
          qty: number
          referrer_commission_cop: number
          status: string
          total_cop: number
        }[]
      }
      admin_order_line_summaries: {
        Args: { p_order_line_ids: string[] }
        Returns: {
          establishment_name: Json
          holder_name: string
          order_id: string
          order_line_id: string
          product_name: Json
        }[]
      }
      admin_orders_list: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
          p_product_id?: string
          p_q?: string
          p_sort_desc?: boolean
          p_sort_key?: string
          p_status?: string
        }
        Returns: {
          created_at: string
          date: string
          end_date: string
          establishment_name: Json
          holder_name: string
          holder_phone: string
          id: string
          order_id: string
          product_name: Json
          qty: number
          referrer_display_name: string
          status: string
          total_cop: number
          total_count: number
        }[]
      }
      apply_order_line_ledger_transition: {
        Args: { p_new_status: string; p_order_line_ids: string[] }
        Returns: undefined
      }
      apply_payment_webhook: {
        Args: {
          p_external_reference: string
          p_mp_payment_id: string
          p_raw_event: Json
          p_status: string
        }
        Returns: Json
      }
      apply_payment_webhook_checked: {
        Args: {
          p_external_reference: string
          p_mp_payment_id: string
          p_raw_event: Json
          p_status: string
          p_transaction_amount: number
        }
        Returns: Json
      }
      attach_orders_to_account: { Args: never; Returns: Json }
      cancel_order_line: { Args: { p_line_id: string }; Returns: Json }
      check_partner_invitation: { Args: { p_token: string }; Returns: Json }
      claim_notification_email_batch: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          body_html: string
          created_at: string
          event_type: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          provider_message_id: string | null
          recipient_account_id: string | null
          recipient_email: string
          related_id: string | null
          related_table: string | null
          sent_at: string | null
          status: string
          subject: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_emails"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_order_for_pms_booking: {
        Args: { p_order_id: string }
        Returns: Json
      }
      claim_orders_to_reconcile: {
        Args: { p_limit?: number }
        Returns: {
          claimed_at: string
          created_at: string
          order_id: string
          payment_status: string
          payments: Json
        }[]
      }
      claim_payment_refunds: {
        Args: { p_limit?: number }
        Returns: {
          amount_cop: number
          attempts: number
          claimed_at: string
          mp_payment_id: string
          refund_id: string
        }[]
      }
      claim_payments_to_watch: {
        Args: { p_limit?: number }
        Returns: {
          claimed_at: string
          order_id: string
          payment_id: string
        }[]
      }
      claim_pms_cancellation_batch: {
        Args: { p_limit?: number; p_max_attempts?: number }
        Returns: {
          attempts: number
          entry_id: string
          establishment_id: string
          hifago_status: string
          lobby_api_token: string
          pms_booking_id: string
        }[]
      }
      claim_pms_poll_batch: {
        Args: { p_limit?: number }
        Returns: {
          establishment_id: string
          lobby_api_token: string
          order_line_id: string
          pms_booking_id: string
        }[]
      }
      claim_pms_sync_batch: {
        Args: {
          p_fresh_far?: string
          p_fresh_near?: string
          p_limit?: number
          p_visibility?: string
        }
        Returns: {
          establishment_id: string
          lobby_api_token: string
          month: string
        }[]
      }
      client_key_for_order: {
        Args: {
          p_account_id: string
          p_holder_email: string
          p_holder_phone: string
          p_order_id: string
        }
        Returns: string
      }
      consume_partner_invitation: {
        Args: {
          p_document_version: string
          p_ip?: string
          p_signer_name: string
          p_token: string
          p_user_agent?: string
        }
        Returns: Json
      }
      create_campaign: {
        Args: {
          p_audience: string
          p_channel: string
          p_message_template: string
        }
        Returns: Json
      }
      create_establishment: {
        Args: {
          p_address?: string
          p_description?: Json
          p_lat?: number
          p_lon?: number
          p_name: Json
          p_operated_directly?: boolean
          p_partner_id: string
        }
        Returns: string
      }
      create_manual_order_line: {
        Args: {
          p_date: string
          p_holder_name: string
          p_holder_phone?: string
          p_note?: string
          p_product_id: string
          p_qty: number
          p_slot_start_time?: string
        }
        Returns: Json
      }
      create_order: {
        Args: {
          p_holder_email?: string
          p_holder_name: string
          p_holder_phone?: string
          p_marketing_consent?: boolean
        }
        Returns: Json
      }
      create_partner_direct: {
        Args: {
          p_code?: string
          p_commission_enabled?: boolean
          p_crm_profile?: Json
          p_display_name: string
          p_email?: string
          p_establishment_id?: string
          p_identification_number?: string
          p_identification_type?: string
          p_invitation_expires_days?: number
          p_legal_name?: string
          p_partner_city?: string
          p_phone?: string
          p_roles: string[]
          p_send_invitation?: boolean
        }
        Returns: Json
      }
      create_partner_invitation: {
        Args: {
          p_code: string
          p_email?: string
          p_expires_days?: number
          p_onboarding_path: string
          p_partner_hint?: Json
        }
        Returns: Json
      }
      create_payment_intent: { Args: { p_order_id: string }; Returns: Json }
      create_product_from_proposal: {
        Args: {
          p_establishment_id: string
          p_partner_id: string
          p_payload: Json
          p_type: string
        }
        Returns: string
      }
      delete_my_account: { Args: never; Returns: Json }
      delete_product: {
        Args: { p_note?: string; p_product_id: string }
        Returns: undefined
      }
      enqueue_notification_email: {
        Args: {
          p_body_html: string
          p_event_type: string
          p_recipient_account_id: string
          p_recipient_email: string
          p_related_id?: string
          p_related_table?: string
          p_subject: string
        }
        Returns: string
      }
      establishment_slug_from_name: {
        Args: { p_exclude?: string; p_name: Json }
        Returns: string
      }
      expand_event_occurrences: {
        Args: { p_from: string; p_product_id: string; p_to: string }
        Returns: string[]
      }
      expand_product_slots: {
        Args: { p_date: string; p_product_id: string }
        Returns: {
          capacity: number
          slot_duration_minutes: number
          slot_start_time: string
        }[]
      }
      expire_payment_order: {
        Args: { p_checked_at: string; p_force?: boolean; p_order_id: string }
        Returns: Json
      }
      fail_payment_refund: {
        Args: { p_error: string; p_refund_id: string }
        Returns: undefined
      }
      fail_pms_sync: {
        Args: {
          p_error: string
          p_establishment_id: string
          p_month: string
          p_retry_after_seconds?: number
        }
        Returns: undefined
      }
      finalize_payment_refund: {
        Args: {
          p_error?: string
          p_mp_refund_id?: string
          p_outcome: string
          p_raw?: Json
          p_refund_id: string
        }
        Returns: Json
      }
      get_event_occurrence_availability: {
        Args: { p_from: string; p_product_id: string; p_to: string }
        Returns: {
          booked: number
          capacity: number
          occurrence_date: string
        }[]
      }
      get_evento_rsvp_counts: {
        Args: { p_from: string; p_product_id: string; p_to: string }
        Returns: {
          occurrence_date: string
          registered_qty: number
        }[]
      }
      get_order_by_token: { Args: { p_token: string }; Returns: Json }
      get_product_slots: {
        Args: { p_from: string; p_product_id: string; p_to: string }
        Returns: {
          booked: number
          capacity: number
          slot_date: string
          slot_duration_minutes: number
          slot_start_time: string
        }[]
      }
      grant_capability: {
        Args: {
          p_establishment_id?: string
          p_note?: string
          p_partner_id: string
          p_role: string
        }
        Returns: Json
      }
      has_admin_capability: { Args: { uid: string }; Returns: boolean }
      has_capability: {
        Args: { p_establishment_id?: string; p_role: string; uid: string }
        Returns: boolean
      }
      haversine_km: {
        Args: { p_lat1: number; p_lat2: number; p_lon1: number; p_lon2: number }
        Returns: number
      }
      heartbeat_job: {
        Args: { p_error?: string; p_job: string; p_ok: boolean; p_stats?: Json }
        Returns: undefined
      }
      html_text: { Args: { p_value: string }; Returns: string }
      invoke_payments_reconcile: { Args: never; Returns: undefined }
      invoke_pms_cancel_bookings: { Args: never; Returns: undefined }
      invoke_pms_nightly_contract_check: { Args: never; Returns: undefined }
      invoke_pms_poll_bookings: { Args: never; Returns: undefined }
      invoke_pms_sync_availability: { Args: never; Returns: undefined }
      invoke_send_notification_emails: { Args: never; Returns: undefined }
      is_admin: { Args: { uid: string }; Returns: boolean }
      is_anonymous_session: { Args: never; Returns: boolean }
      list_audience_members: {
        Args: { p_audience: string }
        Returns: {
          account_id: string
          email: string
          phone: string
          reachable: boolean
        }[]
      }
      list_client_orders: {
        Args: { p_client_key: string }
        Returns: {
          created_at: string
          holder_email: string
          holder_name: string
          holder_phone: string
          order_id: string
          payment_status: string
          referrer_display_name: string
          referrer_partner_id: string
        }[]
      }
      list_clients: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_sort_desc?: boolean
          p_sort_key?: string
          p_status?: string
        }
        Returns: {
          client_key: string
          client_stage: string
          display_name: string
          email: string
          last_order_at: string
          orders_count: number
          phone: string
          total_count: number
        }[]
      }
      list_establishments_admin: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_sort_desc?: boolean
          p_sort_key?: string
          p_status?: string
        }
        Returns: {
          activities_count: number
          id: string
          name: Json
          operator_inactive: boolean
          partner_display_name: string
          partner_id: string
          pending_proposal_id: string
          pending_proposal_kind: string
          status: string
          total_count: number
        }[]
      }
      list_my_orders: { Args: never; Returns: Json }
      list_partners_admin: {
        Args: {
          p_city?: string
          p_lat?: number
          p_limit?: number
          p_lon?: number
          p_offset?: number
          p_radius_km?: number
          p_role?: string
          p_search?: string
          p_sort_desc?: boolean
          p_sort_key?: string
        }
        Returns: {
          active_roles: string
          display_name: string
          establishments_count: number
          id: string
          total_count: number
        }[]
      }
      list_pending_orders_for_viewer: {
        Args: never
        Returns: {
          access_token: string
          id: string
          line_statuses: string[]
          reference: string
        }[]
      }
      lock_order_capacity_rows: {
        Args: { p_line_ids: string[] }
        Returns: undefined
      }
      log_admin_action: {
        Args: {
          p_action: string
          p_after?: Json
          p_before?: Json
          p_entity_id: string
          p_entity_table: string
          p_note?: string
        }
        Returns: undefined
      }
      mark_ledger_entry_paid: {
        Args: {
          p_comprobante_path: string
          p_ledger_entry_id: string
          p_note: string
        }
        Returns: Json
      }
      mark_mp_cancel_attempt: {
        Args: { p_mp_status_after: string; p_payment_id: string }
        Returns: undefined
      }
      mark_notification_email_failed: {
        Args: { p_error: string; p_id: string; p_max_attempts?: number }
        Returns: undefined
      }
      mark_notification_email_sent: {
        Args: { p_id: string; p_provider_message_id: string }
        Returns: undefined
      }
      mark_pms_sync_due: {
        Args: { p_establishment_id: string; p_from: string; p_to: string }
        Returns: undefined
      }
      mark_pms_sync_due_for_order_line: {
        Args: { p_order_line_id: string }
        Returns: undefined
      }
      moderate_establishment_proposal: {
        Args: {
          p_activate_pms_connector?: boolean
          p_corrected_payload?: Json
          p_decision: string
          p_expected_version: number
          p_proposal_id: string
          p_rejection_reason?: string
        }
        Returns: Json
      }
      moderate_product_proposal: {
        Args: {
          p_corrected_payload?: Json
          p_decision: string
          p_expected_version: number
          p_proposal_id: string
          p_rejection_reason?: string
        }
        Returns: Json
      }
      modify_order_line: {
        Args: {
          p_new_date: string
          p_new_end_date?: string
          p_new_qty: number
          p_order_line_id: string
          p_reason: string
        }
        Returns: Json
      }
      next_event_occurrence: {
        Args: {
          p_occurrence_date: string
          p_occurrence_type: string
          p_recurrence_end_count: number
          p_recurrence_end_date: string
          p_recurrence_frequency_days: number
        }
        Returns: string
      }
      normalize_price_tiers: { Args: { p_price_tiers: Json }; Returns: Json }
      notify_all_admins: {
        Args: {
          p_body_html: string
          p_event_type: string
          p_related_id?: string
          p_related_table?: string
          p_subject: string
        }
        Returns: undefined
      }
      offboarding_attest_payments: {
        Args: { p_note: string; p_offboarding_id: string }
        Returns: Json
      }
      offboarding_revoke_capability: {
        Args: { p_note?: string; p_offboarding_id: string }
        Returns: Json
      }
      offboarding_unpublish: {
        Args: { p_offboarding_id: string }
        Returns: Json
      }
      open_default_lodging_availability: {
        Args: { p_horizon?: string; p_product_id: string }
        Returns: undefined
      }
      order_for_client_jsonb: {
        Args: { p_order: Database["public"]["Tables"]["orders"]["Row"] }
        Returns: Json
      }
      order_payment_deadline: {
        Args: { p_created_at: string }
        Returns: string
      }
      partner_agenda_order_lines: {
        Args: { p_date_from: string; p_date_to: string }
        Returns: {
          date: string
          end_date: string
          holder_name: string
          id: string
          product_duration_days: number
          product_id: string
          product_name: Json
          product_type: string
          qty: number
          slot_start_time: string
          status: string
        }[]
      }
      partner_commission_totals: {
        Args: { p_date_from?: string; p_date_to?: string; p_status?: string }
        Returns: {
          amount_cop: number
          status: string
        }[]
      }
      partner_commissions_list: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_entry_id?: string
          p_limit?: number
          p_offset?: number
          p_sort_desc?: boolean
          p_sort_key?: string
          p_status?: string
        }
        Returns: {
          amount_cop: number
          date: string
          establishment_name: Json
          holder_name: string
          id: string
          product_name: Json
          referrer_pct: number
          status: string
          total_cop: number
          total_count: number
        }[]
      }
      partner_id_for_account: { Args: { uid: string }; Returns: string }
      partner_reservation_detail: {
        Args: { p_order_line_id: string }
        Returns: {
          created_at: string
          date: string
          end_date: string
          establishment_name: Json
          holder_email: string
          holder_name: string
          holder_phone: string
          id: string
          product_name: Json
          product_type: string
          qty: number
          slot_start_time: string
          status: string
          total_cop: number
        }[]
      }
      partner_reservations_list: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_holder_q?: string
          p_limit?: number
          p_offset?: number
          p_product_id?: string
          p_sort_desc?: boolean
          p_sort_key?: string
          p_status?: string
        }
        Returns: {
          date: string
          establishment_name: Json
          holder_email: string
          holder_name: string
          holder_phone: string
          id: string
          product_name: Json
          qty: number
          status: string
          total_cop: number
          total_count: number
        }[]
      }
      payments_reconcile_watchdog: { Args: never; Returns: undefined }
      process_campaign_batch: {
        Args: { p_batch_size?: number; p_campaign_id: string }
        Returns: Json
      }
      product_slug_from_name: {
        Args: { p_exclude?: string; p_name: Json }
        Returns: string
      }
      provision_evento_availability: {
        Args: { p_horizon?: string; p_product_id: string }
        Returns: undefined
      }
      purge_expired_anonymous_identities: { Args: never; Returns: Json }
      reconcile_order: {
        Args: {
          p_checked_at: string
          p_collector_id: string
          p_expiry_margin?: string
          p_mp_payments: Json
          p_order_id: string
        }
        Returns: Json
      }
      record_mp_payment_status: {
        Args: {
          p_checked_at: string
          p_collector_id: string
          p_mp_payments: Json
          p_payment_id: string
        }
        Returns: Json
      }
      record_pms_booking: {
        Args: {
          p_claimed_at: string
          p_order_id: string
          p_order_line_id: string
          p_pms_booking_id: string
        }
        Returns: Json
      }
      release_order_after_pms_refusal: {
        Args: { p_order_id: string; p_reason: string }
        Returns: Json
      }
      release_order_line_capacity: {
        Args: { p_line_id: string }
        Returns: undefined
      }
      release_pms_reserve_claim: {
        Args: { p_claimed_at: string; p_order_id: string }
        Returns: Json
      }
      reorder_gallery: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_ordered_media_ids: string[]
        }
        Returns: Json
      }
      replace_product_slot_rules: {
        Args: { p_product_id: string; p_rules: Json }
        Returns: Json
      }
      request_payment_refund: {
        Args: { p_entry_id: string; p_note: string }
        Returns: Json
      }
      requeue_pms_cancellation: {
        Args: { p_entry_id: string; p_error?: string }
        Returns: undefined
      }
      resolve_date_price: {
        Args: {
          p_date: string
          p_product_id: string
          p_stay_rates: Json
          p_tier_base_price_cop: number
        }
        Returns: number
      }
      resolve_lodging_default_capacity: {
        Args: {
          p_capacity: number
          p_lodging_kind: string
          p_unit_count: number
        }
        Returns: number
      }
      resolve_payment_reconciliation_entry: {
        Args: { p_entry_id: string; p_note: string }
        Returns: Json
      }
      resolve_pms_cancellation: {
        Args: {
          p_entry_id: string
          p_error?: string
          p_lobby_status_code?: number
          p_outcome: string
        }
        Returns: undefined
      }
      resolve_reconciliation_entry: {
        Args: { p_entry_id: string; p_note: string }
        Returns: Json
      }
      resolve_tier_price: {
        Args: { p_base_price_cop: number; p_price_tiers: Json; p_qty: number }
        Returns: number
      }
      revoke_partner_invitation: {
        Args: { p_invitation_id: string }
        Returns: Json
      }
      roll_lodging_availability_window: { Args: never; Returns: undefined }
      search_catalog: {
        Args: {
          p_desde?: string
          p_hasta?: string
          p_limite?: number
          p_offset?: number
          p_personas?: number
          p_por_tipo?: number
          p_query?: string
          p_sin_tag?: boolean
          p_tag_slug?: string
          p_tipos?: string[]
        }
        Returns: {
          descripcion: Json
          es_establecimiento: boolean
          establecimiento: Json
          fotos: Json
          id: string
          n_alojamientos: number
          nombre: Json
          precio_cop: number
          precio_desde: number
          precio_label: string
          rango_seccion: number
          slug: string
          tipo: string
          total_seccion: number
        }[]
      }
      search_catalog_categorias: {
        Args: {
          p_desde?: string
          p_hasta?: string
          p_personas?: number
          p_por_categoria?: number
          p_query?: string
          p_tipo: string
        }
        Returns: {
          categoria_description: Json
          categoria_image_path: string
          categoria_label: Json
          categoria_slug: string
          descripcion: Json
          es_establecimiento: boolean
          es_sin_tag: boolean
          establecimiento: Json
          fotos: Json
          id: string
          n_alojamientos: number
          nombre: Json
          precio_cop: number
          precio_desde: number
          precio_label: string
          rango_categoria: number
          slug: string
          tipo: string
          total_categoria: number
        }[]
      }
      set_capability_status: {
        Args: { p_capability_id: string; p_new_status: string; p_note?: string }
        Returns: Json
      }
      set_date_rate: {
        Args: {
          p_date: string
          p_entity_id: string
          p_entity_type: string
          p_note?: string
          p_price_cop: number
        }
        Returns: Json
      }
      set_establishment_payout_account: {
        Args: { p_bank: Json; p_establishment_id: string; p_reason: string }
        Returns: Json
      }
      set_establishment_pms_connector: {
        Args: {
          p_connector_active?: boolean
          p_establishment_id: string
          p_lobby_api_token?: string
          p_reason?: string
        }
        Returns: Json
      }
      set_establishment_status: {
        Args: { p_establishment_id: string; p_note?: string; p_status: string }
        Returns: Json
      }
      set_my_payout_account: {
        Args: { p_mercadopago_account: string }
        Returns: Json
      }
      set_order_line_status: {
        Args: {
          p_new_status: string
          p_order_line_id: string
          p_reason: string
        }
        Returns: Json
      }
      set_partner_code_active: {
        Args: { p_active: boolean; p_code: string; p_note?: string }
        Returns: Json
      }
      set_partner_location: {
        Args: {
          p_address?: string
          p_lat?: number
          p_lon?: number
          p_partner_id: string
        }
        Returns: Json
      }
      set_product_availability: {
        Args: {
          p_capacity: number
          p_date: string
          p_note?: string
          p_open?: boolean
          p_product_id: string
        }
        Returns: Json
      }
      set_product_sellable: {
        Args: { p_note?: string; p_product_id: string; p_sellable: boolean }
        Returns: undefined
      }
      set_product_slot_capacity: {
        Args: {
          p_capacity: number
          p_date: string
          p_note?: string
          p_product_id: string
          p_slot_start_time: string
        }
        Returns: Json
      }
      set_provider_resource_capacity: {
        Args: {
          p_capacity: number
          p_date: string
          p_establishment_id: string
          p_note?: string
        }
        Returns: Json
      }
      slugify: { Args: { p_text: string }; Returns: string }
      start_offboarding: { Args: { p_partner_id: string }; Returns: Json }
      submit_establishment_creation_proposal: {
        Args: { p_payload: Json }
        Returns: Json
      }
      submit_establishment_edit_proposal: {
        Args: { p_establishment_id: string; p_payload: Json }
        Returns: Json
      }
      submit_establishment_photos_proposal: {
        Args: { p_establishment_id: string; p_storage_paths: string[] }
        Returns: Json
      }
      submit_photos_proposal: {
        Args: { p_product_id: string; p_storage_paths: string[] }
        Returns: Json
      }
      submit_product_creation_proposal: {
        Args: { p_establishment_id: string; p_payload: Json; p_type: string }
        Returns: Json
      }
      submit_product_proposal: {
        Args: { p_payload: Json; p_product_id: string }
        Returns: Json
      }
      sync_pms_availability_month: {
        Args: { p_establishment_id: string; p_month: string; p_rows: Json }
        Returns: Json
      }
      today_in_bogota: { Args: never; Returns: string }
      transfer_establishment: {
        Args: {
          p_establishment_id: string
          p_new_partner_id: string
          p_note?: string
        }
        Returns: Json
      }
      update_establishment: {
        Args: {
          p_address?: string
          p_description?: Json
          p_establishment_id: string
          p_lat?: number
          p_lon?: number
          p_name: Json
          p_note?: string
          p_operated_directly?: boolean
        }
        Returns: Json
      }
      update_establishment_contact: {
        Args: { p_contact_phone?: string; p_establishment_id: string }
        Returns: Json
      }
      update_establishment_stay_details: {
        Args: {
          p_check_in_time?: string
          p_check_out_time?: string
          p_establishment_id: string
          p_mode?: string
        }
        Returns: Json
      }
      update_my_account_profile: {
        Args: { p_full_name: string; p_phone?: string }
        Returns: Json
      }
      withdraw_establishment_proposal: {
        Args: { p_proposal_id: string }
        Returns: Json
      }
      withdraw_product_proposal: {
        Args: { p_proposal_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

