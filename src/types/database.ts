export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  api: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      category: {
        Row: {
          applies_to: string | null;
          icon: string | null;
          id: string | null;
          is_active: boolean | null;
          is_custom: boolean | null;
          label: string | null;
          message_key: string | null;
          ordinal: number | null;
        };
        Insert: {
          applies_to?: string | null;
          icon?: string | null;
          id?: string | null;
          is_active?: boolean | null;
          is_custom?: never;
          label?: string | null;
          message_key?: string | null;
          ordinal?: number | null;
        };
        Update: {
          applies_to?: string | null;
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
            referencedRelation: 'personal_scope';
            referencedColumns: ['id', 'base_currency_definition_id'];
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
      personal_scope: {
        Row: {
          base_currency_definition_id: string | null;
          currency_code: string | null;
          currency_scale: number | null;
          id: string | null;
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
      ensure_personal_scope: { Args: { payload: Json }; Returns: Json };
      record_adjustment: { Args: { payload: Json }; Returns: Json };
      record_debt_settlement: { Args: { payload: Json }; Returns: Json };
      record_external_transfer: { Args: { payload: Json }; Returns: Json };
      record_group_expense: { Args: { payload: Json }; Returns: Json };
      record_internal_transfer: { Args: { payload: Json }; Returns: Json };
      record_personal_expense: { Args: { payload: Json }; Returns: Json };
      record_personal_income: { Args: { payload: Json }; Returns: Json };
      record_settlement_by_transfer: { Args: { payload: Json }; Returns: Json };
      rename_custom_category: { Args: { payload: Json }; Returns: Json };
      set_custom_category_active: { Args: { payload: Json }; Returns: Json };
      set_personal_base_currency: { Args: { payload: Json }; Returns: Json };
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
