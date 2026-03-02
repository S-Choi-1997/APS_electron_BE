/**
 * Email Inquiry Service
 *
 * Handles API calls for email consultation inquiries (Gmail and ZOHO Mail)
 */

import { apiRequest } from '../config/api';
import { auth } from '../auth/authManager';

/**
 * Email status constants
 */
export const EMAIL_STATUS = {
  UNREAD: 'unread',
  READ: 'read',
  RESPONDED: 'responded'
};

/**
 * Fetch all email inquiries
 */
export async function fetchEmailInquiries(options = {}) {
  try {
    const { source, check, status, limit, offset, includeOutgoing } = options;

    // Build query string
    const params = new URLSearchParams();
    if (source) params.append('source', source);
    if (check !== undefined) params.append('check', check);
    if (status) params.append('status', status);
    if (limit) params.append('limit', limit);
    if (offset) params.append('offset', offset);
    if (includeOutgoing) params.append('includeOutgoing', 'true');

    const queryString = params.toString();
    const endpoint = queryString ? `/email-inquiries?${queryString}` : '/email-inquiries';

    const response = await apiRequest(endpoint, {
      method: 'GET'
    }, auth);

    // Transform response to include status field
    const data = response.data;
    if (Array.isArray(data)) {
      return data.map(inquiry => ({
        ...inquiry,
        status: inquiry.status || (inquiry.check ? EMAIL_STATUS.READ : EMAIL_STATUS.UNREAD),
        isOutgoing: inquiry.isOutgoing || false  // Backend already sends camelCase
      }));
    }

    return data;
  } catch (error) {
    console.error('[Email Service] Failed to fetch email inquiries:', error);
    throw error;
  }
}

/**
 * Fetch email inquiry statistics
 */
export async function fetchEmailStats() {
  try {
    const response = await apiRequest('/email-inquiries/stats', {
      method: 'GET'
    }, auth);

    return response.data;
  } catch (error) {
    console.error('[Email Service] Failed to fetch email stats:', error);
    throw error;
  }
}

/**
 * Update email inquiry (mark as checked/unchecked or update status)
 */
export async function updateEmailInquiry(id, updates) {
  try {
    const response = await apiRequest(`/email-inquiries/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    }, auth);

    // Transform response
    const data = response.data;
    if (data) {
      return {
        ...data,
        status: data.status || (data.check ? EMAIL_STATUS.READ : EMAIL_STATUS.UNREAD),
        isOutgoing: data.is_outgoing || false
      };
    }

    return data;
  } catch (error) {
    console.error('[Email Service] Failed to update email inquiry:', error);
    throw error;
  }
}

/**
 * Delete email inquiry
 */
export async function deleteEmailInquiry(id) {
  try {
    const response = await apiRequest(`/email-inquiries/${id}`, {
      method: 'DELETE'
    }, auth);

    return response.data;
  } catch (error) {
    console.error('[Email Service] Failed to delete email inquiry:', error);
    throw error;
  }
}

/**
 * Trigger manual ZOHO sync
 */
export async function triggerZohoSync() {
  try {
    const response = await apiRequest('/api/zoho/sync', {
      method: 'POST'
    }, auth);

    // apiRequest already returns parsed JSON, no need for .data
    return response;
  } catch (error) {
    console.error('[Email Service] Failed to trigger ZOHO sync:', error);
    throw error;
  }
}

/**
 * Send email response to an inquiry
 *
 * @param {string} emailId - Email inquiry ID
 * @param {string} responseText - Response text to send
 * @param {Object} originalEmail - Original email data (from, subject, messageId)
 * @returns {Promise<Object>} Response result
 */
export async function sendEmailResponse(emailId, responseText, originalEmail) {
  try {
    const response = await apiRequest('/api/email-response', {
      method: 'POST',
      body: JSON.stringify({
        emailId,
        responseText,
        originalEmail
      })
    }, auth);

    return response;
  } catch (error) {
    console.error('[Email Service] Failed to send email response:', error);
    throw error;
  }
}
