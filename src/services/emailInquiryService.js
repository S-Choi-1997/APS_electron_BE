/**
 * Email Inquiry Service
 *
 * Handles API calls for email consultation inquiries (Gmail and ZOHO Mail)
 */

import { apiRequest } from '../config/api';
import { auth } from '../auth/authManager';
import { mockEmailInquiries, mockEmailStats } from '../data/mockEmailData';

// Development mode flag
const USE_MOCK_DATA = true; // Set to false when backend is ready

/**
 * Fetch all email inquiries
 */
export async function fetchEmailInquiries(options = {}) {
  try {
    const { source, check, limit, offset } = options;

    if (USE_MOCK_DATA) {
      console.log('[Email Service] Using mock data (Phase 1)');

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 500));

      let filtered = [...mockEmailInquiries];

      // Apply filters
      if (source) {
        filtered = filtered.filter(item => item.source === source);
      }
      if (check !== undefined) {
        filtered = filtered.filter(item => item.check === check);
      }

      return filtered;
    }

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
 * TODO: Replace with actual API call
 */
export async function fetchEmailStats() {
  try {
    if (USE_MOCK_DATA) {
      console.log('[Email Service] Using mock stats (Phase 1)');

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 300));

      return mockEmailStats;
    }

    // TODO Phase 2: Actual API call
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
    if (USE_MOCK_DATA) {
      console.log('[Email Service] Mock update (Phase 1):', { id, updates });

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 300));

      // Find and update in mock data
      const inquiry = mockEmailInquiries.find(item => item.id === id);
      if (inquiry) {
        Object.assign(inquiry, updates, { updatedAt: new Date() });
        return inquiry;
      }

      throw new Error('Inquiry not found');
    }

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
 * TODO: Replace with actual API call
 */
export async function deleteEmailInquiry(id) {
  try {
    if (USE_MOCK_DATA) {
      console.log('[Email Service] Mock delete (Phase 1):', id);

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 300));

      // Remove from mock data
      const index = mockEmailInquiries.findIndex(item => item.id === id);
      if (index !== -1) {
        mockEmailInquiries.splice(index, 1);
        return { success: true };
      }

      throw new Error('Inquiry not found');
    }

    // TODO Phase 2: Actual API call
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
    if (USE_MOCK_DATA) {
      console.log('[Email Service] ZOHO sync not available in mock mode (Phase 1)');
      throw new Error('ZOHO sync not available in Phase 1');
    }

    const response = await apiRequest('/api/zoho/sync', {
      method: 'POST'
    }, auth);

    return response.data;
  } catch (error) {
    console.error('[Email Service] Failed to trigger ZOHO sync:', error);
    throw error;
  }
}
