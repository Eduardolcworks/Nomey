export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  api: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      category: {
        Row: {
          icon: string | null;
          id: string | null;
          is_active: boolean | null;
          is_custom: boolean | null;
          label: string | null;
          message_key: string | null;
          ordinal: number | null;
        };
        Insert: {
          icon?: string | null;
          id?: string | null;
          is_active?: boolean | null;
          is_custom?: never;
          label?: string | null;
          message_key?: string | null;
          ordinal?: number | null;
        };
        Update: {
          icon?: string | null;
          id?: string | null;
          is_active?: boolean | null;
          is_custom?: never;
          label?: string | null;
          message_key?: string | null;
          ordinal?: number | null;
        };
        Relationships: [];
      };
      currency_definition: {
        Row: {
          code: string | null;
          id: string | null;
          scale: number | null;
        };
        Insert: {
          code?: string | null;
          id?: string | null;
          scale?: number | null;
        };
        Update: {
          code?: string | null;
          id?: string | null;
          scale?: number | null;
        };
        Relationships: [];
      };
      group_balance: {
        Row: {
          currency_definition_id: string | null;
          display_name: string | null;
          is_self: boolean | null;
          net_position: string | null;
          participant_id: string | null;
          scope_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'participant_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id'];
          },
          {
            foreignKeyName: 'participant_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'scope_base_currency_definition_id_fkey';
            columns: ['currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'currency_definition';
            referencedColumns: ['id'];
          },
        ];
      };
      group_notice: {
        Row: {
          by_me: boolean | null;
          group_display_name: string | null;
          id: string | null;
          kind: string | null;
          occurred_at: string | null;
          operation_id: string | null;
          participant_display_name: string | null;
          participant_id: string | null;
          read_at: string | null;
          scope_id: string | null;
          subject_id: string | null;
        };
        Insert: {
          by_me?: never;
          group_display_name?: never;
          id?: string | null;
          kind?: string | null;
          occurred_at?: string | null;
          operation_id?: never;
          participant_display_name?: never;
          participant_id?: never;
          read_at?: string | null;
          scope_id?: string | null;
          subject_id?: string | null;
        };
        Update: {
          by_me?: never;
          group_display_name?: never;
          id?: string | null;
          kind?: string | null;
          occurred_at?: string | null;
          operation_id?: never;
          participant_display_name?: never;
          participant_id?: never;
          read_at?: string | null;
          scope_id?: string | null;
          subject_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'group_notice_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id'];
          },
          {
            foreignKeyName: 'group_notice_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id'];
          },
        ];
      };
      group_operation: {
        Row: {
          category_id: string | null;
          concept: string | null;
          currency_definition_id: string | null;
          effective_date: string | null;
          effective_time: string | null;
          operation_created_at: string | null;
          operation_id: string | null;
          payer_participant_id: string | null;
          previous_amount: string | null;
          previous_version_id: string | null;
          scope_id: string | null;
          split_method: string | null;
          total_amount: string | null;
          total_order: number | null;
          version_id: string | null;
          version_no: number | null;
          your_share: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'effect_moneda_del_ambito';
            columns: ['scope_id', 'currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id', 'currency_definition_id'];
          },
          {
            foreignKeyName: 'effect_moneda_del_ambito';
            columns: ['scope_id', 'currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id', 'base_currency_definition_id'];
          },
          {
            foreignKeyName: 'effect_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id'];
          },
          {
            foreignKeyName: 'effect_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'expense_category_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'category';
            referencedColumns: ['id'];
          },
        ];
      };
      group_participant: {
        Row: {
          created_at: string | null;
          display_name: string | null;
          eligible_until: string | null;
          has_history: boolean | null;
          is_active: boolean | null;
          is_departed: boolean | null;
          is_linked: boolean | null;
          is_retired: boolean | null;
          is_self: boolean | null;
          merged_into_participant_id: string | null;
          participant_id: string | null;
          scope_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'participant_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id'];
          },
          {
            foreignKeyName: 'participant_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id'];
          },
        ];
      };
      group_payment: {
        Row: {
          amount: string | null;
          annulled: boolean | null;
          declared_by_receiver: boolean | null;
          effective_date: string | null;
          effective_time: string | null;
          operation_created_at: string | null;
          operation_id: string | null;
          payer_participant_id: string | null;
          receiver_participant_id: string | null;
          recorded_by_me: boolean | null;
          scope_id: string | null;
          version_id: string | null;
          version_no: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_detail_pagador_del_ambito';
            columns: ['payer_participant_id', 'scope_id'];
            isOneToOne: false;
            referencedRelation: 'group_balance';
            referencedColumns: ['participant_id', 'scope_id'];
          },
          {
            foreignKeyName: 'payment_detail_pagador_del_ambito';
            columns: ['payer_participant_id', 'scope_id'];
            isOneToOne: false;
            referencedRelation: 'group_participant';
            referencedColumns: ['participant_id', 'scope_id'];
          },
          {
            foreignKeyName: 'payment_detail_receptor_del_ambito';
            columns: ['receiver_participant_id', 'scope_id'];
            isOneToOne: false;
            referencedRelation: 'group_balance';
            referencedColumns: ['participant_id', 'scope_id'];
          },
          {
            foreignKeyName: 'payment_detail_receptor_del_ambito';
            columns: ['receiver_participant_id', 'scope_id'];
            isOneToOne: false;
            referencedRelation: 'group_participant';
            referencedColumns: ['participant_id', 'scope_id'];
          },
          {
            foreignKeyName: 'payment_detail_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id'];
          },
          {
            foreignKeyName: 'payment_detail_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id'];
          },
        ];
      };
      group_payment_allocation: {
        Row: {
          amount: string | null;
          creditor_participant_id: string | null;
          debtor_participant_id: string | null;
          kind: string | null;
          operation_id: string | null;
          ordinal: number | null;
          scope_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_allocation_acreedor_del_ambito';
            columns: ['creditor_participant_id', 'scope_id'];
            isOneToOne: false;
            referencedRelation: 'group_balance';
            referencedColumns: ['participant_id', 'scope_id'];
          },
          {
            foreignKeyName: 'payment_allocation_acreedor_del_ambito';
            columns: ['creditor_participant_id', 'scope_id'];
            isOneToOne: false;
            referencedRelation: 'group_participant';
            referencedColumns: ['participant_id', 'scope_id'];
          },
          {
            foreignKeyName: 'payment_allocation_deudor_del_ambito';
            columns: ['debtor_participant_id', 'scope_id'];
            isOneToOne: false;
            referencedRelation: 'group_balance';
            referencedColumns: ['participant_id', 'scope_id'];
          },
          {
            foreignKeyName: 'payment_allocation_deudor_del_ambito';
            columns: ['debtor_participant_id', 'scope_id'];
            isOneToOne: false;
            referencedRelation: 'group_participant';
            referencedColumns: ['participant_id', 'scope_id'];
          },
          {
            foreignKeyName: 'payment_allocation_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id'];
          },
          {
            foreignKeyName: 'payment_allocation_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id'];
          },
        ];
      };
      group_pending_pair: {
        Row: {
          amount: string | null;
          creditor_participant_id: string | null;
          debtor_participant_id: string | null;
          scope_id: string | null;
        };
        Relationships: [];
      };
      group_profile: {
        Row: {
          base_currency_definition_id: string | null;
          created_at: string | null;
          currency_code: string | null;
          currency_scale: number | null;
          default_category_id: string | null;
          display_name: string | null;
          emoji: string | null;
          last_activity_at: string | null;
          participant_count: number | null;
          scope_id: string | null;
          updated_at: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'group_profile_default_category_id_fkey';
            columns: ['default_category_id'];
            isOneToOne: false;
            referencedRelation: 'category';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'group_profile_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: true;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id'];
          },
          {
            foreignKeyName: 'group_profile_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: true;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'scope_base_currency_definition_id_fkey';
            columns: ['base_currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'currency_definition';
            referencedColumns: ['id'];
          },
        ];
      };
      group_split_participant: {
        Row: {
          declared_amount: string | null;
          declared_weight: string | null;
          ordinal: number | null;
          participant_id: string | null;
          resolved_amount: string | null;
          scope_id: string | null;
          split_method: string | null;
          version_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'split_participant_del_ambito';
            columns: ['participant_id', 'scope_id'];
            isOneToOne: false;
            referencedRelation: 'group_balance';
            referencedColumns: ['participant_id', 'scope_id'];
          },
          {
            foreignKeyName: 'split_participant_del_ambito';
            columns: ['participant_id', 'scope_id'];
            isOneToOne: false;
            referencedRelation: 'group_participant';
            referencedColumns: ['participant_id', 'scope_id'];
          },
        ];
      };
      group_summary: {
        Row: {
          currency_definition_id: string | null;
          expense_count: number | null;
          max_total: string | null;
          net_position: string | null;
          scope_id: string | null;
          total_amount: string | null;
          your_share: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'effect_moneda_del_ambito';
            columns: ['scope_id', 'currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id', 'currency_definition_id'];
          },
          {
            foreignKeyName: 'effect_moneda_del_ambito';
            columns: ['scope_id', 'currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id', 'base_currency_definition_id'];
          },
          {
            foreignKeyName: 'effect_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id'];
          },
          {
            foreignKeyName: 'effect_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id'];
          },
        ];
      };
      my_account_handle: {
        Row: {
          can_change_at: string | null;
          handle: string | null;
          public_name: string | null;
          reserved_until: string | null;
          state: string | null;
        };
        Relationships: [];
      };
      my_payment_requests: {
        Row: {
          amount: string | null;
          concept: string | null;
          created_at: string | null;
          currency_definition_id: string | null;
          expires_at: string | null;
          paid_at: string | null;
          paid_operation_id: string | null;
          payer_handle: string | null;
          payer_public_name: string | null;
          request_id: string | null;
          state: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'payment_request_currency_definition_id_fkey';
            columns: ['currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'currency_definition';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'payment_request_paid_operation_id_fkey';
            columns: ['paid_operation_id'];
            isOneToOne: false;
            referencedRelation: 'group_operation';
            referencedColumns: ['operation_id'];
          },
          {
            foreignKeyName: 'payment_request_paid_operation_id_fkey';
            columns: ['paid_operation_id'];
            isOneToOne: false;
            referencedRelation: 'group_payment';
            referencedColumns: ['operation_id'];
          },
          {
            foreignKeyName: 'payment_request_paid_operation_id_fkey';
            columns: ['paid_operation_id'];
            isOneToOne: false;
            referencedRelation: 'group_payment_allocation';
            referencedColumns: ['operation_id'];
          },
          {
            foreignKeyName: 'payment_request_paid_operation_id_fkey';
            columns: ['paid_operation_id'];
            isOneToOne: false;
            referencedRelation: 'my_transfers';
            referencedColumns: ['operation_id'];
          },
          {
            foreignKeyName: 'payment_request_paid_operation_id_fkey';
            columns: ['paid_operation_id'];
            isOneToOne: false;
            referencedRelation: 'personal_operation';
            referencedColumns: ['operation_id'];
          },
          {
            foreignKeyName: 'payment_request_paid_operation_id_fkey';
            columns: ['paid_operation_id'];
            isOneToOne: false;
            referencedRelation: 'personal_operation_version';
            referencedColumns: ['operation_id'];
          },
        ];
      };
      my_transfer_proposals: {
        Row: {
          accepted_operation_id: string | null;
          amount: string | null;
          concept: string | null;
          counterpart_handle: string | null;
          counterpart_public_name: string | null;
          created_at: string | null;
          currency_definition_id: string | null;
          direction: string | null;
          expires_at: string | null;
          proposal_id: string | null;
          state: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'transfer_proposal_accepted_operation_id_fkey';
            columns: ['accepted_operation_id'];
            isOneToOne: false;
            referencedRelation: 'group_operation';
            referencedColumns: ['operation_id'];
          },
          {
            foreignKeyName: 'transfer_proposal_accepted_operation_id_fkey';
            columns: ['accepted_operation_id'];
            isOneToOne: false;
            referencedRelation: 'group_payment';
            referencedColumns: ['operation_id'];
          },
          {
            foreignKeyName: 'transfer_proposal_accepted_operation_id_fkey';
            columns: ['accepted_operation_id'];
            isOneToOne: false;
            referencedRelation: 'group_payment_allocation';
            referencedColumns: ['operation_id'];
          },
          {
            foreignKeyName: 'transfer_proposal_accepted_operation_id_fkey';
            columns: ['accepted_operation_id'];
            isOneToOne: false;
            referencedRelation: 'my_transfers';
            referencedColumns: ['operation_id'];
          },
          {
            foreignKeyName: 'transfer_proposal_accepted_operation_id_fkey';
            columns: ['accepted_operation_id'];
            isOneToOne: false;
            referencedRelation: 'personal_operation';
            referencedColumns: ['operation_id'];
          },
          {
            foreignKeyName: 'transfer_proposal_accepted_operation_id_fkey';
            columns: ['accepted_operation_id'];
            isOneToOne: false;
            referencedRelation: 'personal_operation_version';
            referencedColumns: ['operation_id'];
          },
          {
            foreignKeyName: 'transfer_proposal_currency_definition_id_fkey';
            columns: ['currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'currency_definition';
            referencedColumns: ['id'];
          },
        ];
      };
      my_transfers: {
        Row: {
          amount: string | null;
          balance_amount: string | null;
          concept: string | null;
          counterpart_handle: string | null;
          counterpart_public_name: string | null;
          currency_definition_id: string | null;
          direction: string | null;
          effective_date: string | null;
          effective_time: string | null;
          operation_created_at: string | null;
          operation_id: string | null;
          payment_request_id: string | null;
          proposal_id: string | null;
          scope_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'effect_moneda_del_ambito';
            columns: ['scope_id', 'currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id', 'currency_definition_id'];
          },
          {
            foreignKeyName: 'effect_moneda_del_ambito';
            columns: ['scope_id', 'currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id', 'base_currency_definition_id'];
          },
          {
            foreignKeyName: 'effect_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id'];
          },
          {
            foreignKeyName: 'effect_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id'];
          },
        ];
      };
      personal_balance: {
        Row: {
          balance_amount: string | null;
          currency_definition_id: string | null;
          scope_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'scope_base_currency_definition_id_fkey';
            columns: ['currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'currency_definition';
            referencedColumns: ['id'];
          },
        ];
      };
      personal_effect: {
        Row: {
          accounting_class: string | null;
          balance_amount: string | null;
          currency_definition_id: string | null;
          economic_amount: string | null;
          effective_date: string | null;
          id: string | null;
          scope_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'effect_moneda_del_ambito';
            columns: ['scope_id', 'currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id', 'currency_definition_id'];
          },
          {
            foreignKeyName: 'effect_moneda_del_ambito';
            columns: ['scope_id', 'currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id', 'base_currency_definition_id'];
          },
          {
            foreignKeyName: 'effect_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id'];
          },
          {
            foreignKeyName: 'effect_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id'];
          },
        ];
      };
      personal_operation: {
        Row: {
          balance_amount: string | null;
          category_id: string | null;
          concept: string | null;
          currency_definition_id: string | null;
          current_version_id: string | null;
          effective_date: string | null;
          effective_time: string | null;
          group_display_name: string | null;
          group_scope_id: string | null;
          operation_class: string | null;
          operation_created_at: string | null;
          operation_id: string | null;
          original_amount: string | null;
          payment_counterpart: string | null;
          previous_version_id: string | null;
          scope_id: string | null;
          target_balance: string | null;
          version_no: number | null;
          your_share: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'effect_moneda_del_ambito';
            columns: ['scope_id', 'currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id', 'currency_definition_id'];
          },
          {
            foreignKeyName: 'effect_moneda_del_ambito';
            columns: ['scope_id', 'currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id', 'base_currency_definition_id'];
          },
          {
            foreignKeyName: 'effect_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_balance';
            referencedColumns: ['scope_id'];
          },
          {
            foreignKeyName: 'effect_scope_id_fkey';
            columns: ['scope_id'];
            isOneToOne: false;
            referencedRelation: 'personal_scope';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'expense_category_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'category';
            referencedColumns: ['id'];
          },
        ];
      };
      personal_operation_version: {
        Row: {
          category_id: string | null;
          concept: string | null;
          currency_definition_id: string | null;
          effective_date: string | null;
          effective_time: string | null;
          is_current: boolean | null;
          operation_class: string | null;
          operation_id: string | null;
          operation_version_id: string | null;
          original_amount: string | null;
          supersedes_version_id: string | null;
          target_balance: string | null;
          version_created_at: string | null;
          version_no: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'expense_category_category_id_fkey';
            columns: ['category_id'];
            isOneToOne: false;
            referencedRelation: 'category';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'operation_version_original_currency_definition_id_fkey';
            columns: ['currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'currency_definition';
            referencedColumns: ['id'];
          },
        ];
      };
      personal_scope: {
        Row: {
          base_currency_definition_id: string | null;
          currency_code: string | null;
          currency_scale: number | null;
          id: string | null;
          needs_start_decision: boolean | null;
          provisioned_as_guest: boolean | null;
          start_mode: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'scope_base_currency_definition_id_fkey';
            columns: ['base_currency_definition_id'];
            isOneToOne: false;
            referencedRelation: 'currency_definition';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Functions: {
      annul_operation: { Args: { payload: Json }; Returns: Json };
      associate_participant: { Args: { payload: Json }; Returns: Json };
      cancel_payment_request: { Args: { payload: Json }; Returns: Json };
      cancel_transfer_proposal: { Args: { payload: Json }; Returns: Json };
      change_username: {
        Args: { payload: Json };
        Returns: {
          can_change_at: string;
          handle: string;
          public_name: string;
          reserved_until: string;
          state: string;
        }[];
      };
      claim_username: {
        Args: never;
        Returns: {
          can_change_at: string;
          handle: string;
          public_name: string;
          reserved_until: string;
          state: string;
        }[];
      };
      claimed_dimension: {
        Args: never;
        Returns: {
          accounting_class: string;
          amount: string;
          currency_definition_id: string;
          dimension: string;
          effective_date: string;
        }[];
      };
      create_custom_category: { Args: { payload: Json }; Returns: Json };
      create_group: { Args: { payload: Json }; Returns: Json };
      create_group_invitation: { Args: { payload: Json }; Returns: Json };
      create_payment_request: { Args: { payload: Json }; Returns: Json };
      create_transfer_proposal: { Args: { payload: Json }; Returns: Json };
      decline_transfer_proposal: { Args: { payload: Json }; Returns: Json };
      ensure_personal_scope: { Args: { payload: Json }; Returns: Json };
      group_reopened_pair: {
        Args: { p_scope: string };
        Returns: {
          amount: string;
          creditor_participant_id: string;
          debtor_participant_id: string;
        }[];
      };
      leave_group: { Args: { payload: Json }; Returns: Json };
      mark_group_notice_read: { Args: { p_id: string }; Returns: undefined };
      mark_group_notices_seen: { Args: { p_newest: string }; Returns: number };
      my_group_payment: {
        Args: never;
        Returns: {
          amount: string;
          annulled: boolean;
          annulled_by_me: boolean;
          counterpart_display_name: string;
          effective_date: string;
          expected_version_id: string;
          group_display_name: string;
          i_paid: boolean;
          operation_id: string;
          recorded_by_me: boolean;
          scope_id: string;
        }[];
      };
      my_reopened_debt: {
        Args: never;
        Returns: {
          amount: string;
          currency_definition_id: string;
        }[];
      };
      observed_balance: {
        Args: { p_operation_ids?: string[] };
        Returns: {
          is_current: boolean;
          observed_balance_after: string;
          observed_balance_before: string;
          operation_id: string;
          operation_version_id: string;
          scope_id: string;
        }[];
      };
      personal_expense_share: {
        Args: { p_from?: string; p_to?: string };
        Returns: {
          category_id: string;
          concept: string;
          currency_code: string;
          currency_definition_id: string;
          currency_scale: number;
          current_version_id: string;
          effective_date: string;
          effective_time: string;
          group_display_name: string;
          group_emoji: string;
          operation_created_at: string;
          operation_id: string;
          payer_display_name: string;
          scope_id: string;
          share_amount: string;
          total_amount: string;
        }[];
      };
      personal_statistics: {
        Args: { p_from?: string; p_to?: string };
        Returns: Json;
      };
      preview_invitation: { Args: { p_token: string }; Returns: Json };
      preview_payment_request: { Args: { p_token: string }; Returns: Json };
      record_adjustment: { Args: { payload: Json }; Returns: Json };
      record_debt_settlement: { Args: { payload: Json }; Returns: Json };
      record_external_transfer: { Args: { payload: Json }; Returns: Json };
      record_group_expense: { Args: { payload: Json }; Returns: Json };
      record_group_payment: { Args: { payload: Json }; Returns: Json };
      record_internal_transfer: { Args: { payload: Json }; Returns: Json };
      record_personal_expense: { Args: { payload: Json }; Returns: Json };
      record_personal_income: { Args: { payload: Json }; Returns: Json };
      record_settlement_by_transfer: { Args: { payload: Json }; Returns: Json };
      redeem_invitation: { Args: { payload: Json }; Returns: Json };
      rename_custom_category: { Args: { payload: Json }; Returns: Json };
      reserve_username: {
        Args: { payload: Json };
        Returns: {
          can_change_at: string;
          handle: string;
          public_name: string;
          reserved_until: string;
          state: string;
        }[];
      };
      resolve_username: {
        Args: { p_handle: string };
        Returns: {
          handle: string;
          public_name: string;
          state: string;
        }[];
      };
      retire_participant: { Args: { payload: Json }; Returns: Json };
      revoke_group_invitation: { Args: { payload: Json }; Returns: Json };
      set_custom_category_active: { Args: { payload: Json }; Returns: Json };
      set_personal_base_currency: { Args: { payload: Json }; Returns: Json };
      set_public_name: {
        Args: { payload: Json };
        Returns: {
          can_change_at: string;
          handle: string;
          public_name: string;
          reserved_until: string;
          state: string;
        }[];
      };
      settle_participant: { Args: { payload: Json }; Returns: Json };
      start_personal_scope: { Args: { payload: Json }; Returns: Json };
      update_group_profile: { Args: { payload: Json }; Returns: Json };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  api: {
    Enums: {},
  },
} as const;
