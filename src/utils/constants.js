'use strict';
/** Constantes métier partagées (enums, rôles, statuts). */

module.exports = {
  ROLES: {
    SUPER_ADMIN: 'super_admin',
    DIRECTOR: 'director',
    CREDIT_MANAGER: 'credit_manager',
    CASHIER: 'cashier',
    AGENT: 'agent',
    COMMITTEE_MEMBER: 'committee_member',
    VIEWER: 'viewer',
  },

  MEMBER_STATUS: ['active', 'suspended', 'closed', 'pending'],
  ACCOUNT_TYPES: ['savings', 'fixed_deposit', 'blocked'],
  ACCOUNT_STATUS: ['active', 'blocked', 'closed'],

  TRANSACTION_TYPES: [
    'deposit', 'withdrawal', 'interest',
    'credit_disbursement', 'repayment', 'fee',
  ],
  TRANSACTION_STATUS: ['pending', 'completed', 'failed', 'cancelled'],
  PAYMENT_METHODS: ['cash', 'mobile_money', 'bank_transfer', 'auto_debit'],

  CREDIT_APP_STATUS: [
    'submitted', 'under_review', 'agent_visit', 'pending_committee',
    'approved', 'rejected', 'more_info', 'disbursed', 'completed', 'cancelled',
  ],
  CREDIT_STATUS: [
    'pending_disbursement', 'active', 'in_arrears',
    'restructured', 'completed', 'written_off',
  ],
  COLLECTION_STATUS: [
    'normal', 'late_3days', 'late_7days', 'late_15days', 'late_30days', 'legal_action',
  ],
  REPAYMENT_STATUS: ['pending', 'paid', 'partial', 'overdue', 'waived'],

  VOTE_DECISION: ['approve', 'reject', 'more_info', 'abstain'],

  NOTIF_TYPES: ['push', 'sms', 'email', 'in_app'],
  NOTIF_CHANNELS: ['fcm', 'multipay', 'smtp', 'database'],
  NOTIF_PRIORITY: ['low', 'medium', 'high', 'critical'],
  NOTIF_STATUS: ['pending', 'sent', 'delivered', 'failed', 'read'],

  AUDIT_MODULES: [
    'auth', 'member', 'account', 'transaction', 'credit',
    'committee', 'report', 'admin', 'notification', 'system',
  ],

  // Statuts normalisés retournés par la couche paiement (indépendants du provider)
  PAYMENT_RESULT: {
    PENDING: 'pending',
    SUCCESS: 'success',
    FAILED: 'failed',
  },

  CURRENCIES: ['CDF', 'USD'],
};
