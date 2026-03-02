/**
 * Mock Email Data for Development
 *
 * This file contains mock email consultation data for frontend development.
 * Replace with actual API calls in Phase 2 of ZOHO Mail integration.
 */

export const mockEmailInquiries = [
  {
    id: 'email_001',
    source: 'zoho',
    from: 'customer1@example.com',
    subject: '홈페이지 제작 문의드립니다',
    body: '안녕하세요. 소규모 카페를 운영하고 있습니다.\n\n홈페이지 제작 비용과 기간이 궁금합니다.\n메뉴 소개와 예약 기능이 필요합니다.\n\n견적 부탁드립니다.',
    receivedAt: new Date('2025-12-19T10:30:00'),
    check: false,
    createdAt: new Date('2025-12-19T10:30:00'),
    updatedAt: new Date('2025-12-19T10:30:00')
  },
  {
    id: 'email_002',
    source: 'gmail',
    from: 'business@company.com',
    subject: '쇼핑몰 구축 상담 요청',
    body: '안녕하세요. B2C 쇼핑몰 구축을 계획 중입니다.\n\n현재 상품 약 500개 정도이고, 결제 시스템과 재고 관리 기능이 필요합니다.\n\n가능하다면 빠른 시일 내에 상담 받고 싶습니다.\n감사합니다.',
    receivedAt: new Date('2025-12-19T09:15:00'),
    check: true,
    createdAt: new Date('2025-12-19T09:15:00'),
    updatedAt: new Date('2025-12-19T11:00:00')
  },
  {
    id: 'email_003',
    source: 'zoho',
    from: 'info@startup.com',
    subject: '모바일 앱 개발 문의',
    body: '스타트업 창업을 준비 중입니다.\n\niOS와 Android 앱 개발이 필요한데, 대략적인 개발 기간과 비용을 알고 싶습니다.\n\n간단한 소셜 로그인과 커뮤니티 기능을 포함한 앱입니다.',
    receivedAt: new Date('2025-12-18T16:45:00'),
    check: false,
    createdAt: new Date('2025-12-18T16:45:00'),
    updatedAt: new Date('2025-12-18T16:45:00')
  }
];

export const mockEmailStats = {
  total: 3,
  unread: 2,
  gmail: 1,
  zoho: 2
};
