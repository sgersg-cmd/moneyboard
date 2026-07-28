/**
 * 우리집 머니보드 설정
 *
 * 1) 우선 demoMode: true 상태로 화면과 기능을 확인하세요.
 * 2) Firebase 설정이 끝나면 firebase 값을 채우고 demoMode를 false로 바꾸세요.
 * 3) allowedEmails에는 실제 사용할 부부 이메일 2개만 입력하세요.
 */
window.MONEYBOARD_CONFIG = {
  appName: '우리집 머니보드',
  householdId: 'our-home',
  demoMode: true,
  allowedEmails: [
    'husband@example.com',
    'wife@example.com'
  ],
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  }
};
