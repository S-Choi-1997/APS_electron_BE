/**
 * Email Inquiry Service
 *
 * Handles API calls for email consultation inquiries (Gmail and ZOHO Mail)
 */

import { apiRequest } from '../config/api';
import { auth } from '../auth/authManager';

/**
 * Fetch all email inquiries
 */
export async function fetchEmailInquiries(options = {}) {
  try {
    const { source, check, limit, offset } = options;

    // Build query string
    const params = new URLSearchParams();
    if (source) params.append('source', source);
    if (check !== undefined) params.append('check', check);
    if (limit) params.append('limit', limit);
    if (offset) params.append('offset', offset);

    const queryString = params.toString();
    const endpoint = queryString ? `/email-inquiries?${queryString}` : '/email-inquiries';

    const response = await apiRequest(endpoint, {
      method: 'GET'
    }, auth);

    return response.data;
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
 * Update email inquiry (mark as checked/unchecked)
 */
export async function updateEmailInquiry(id, updates) {
  try {
    const response = await apiRequest(`/email-inquiries/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    }, auth);

    return response.data;
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
