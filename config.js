/**
 * 우리집 머니보드 설정
 */
window.MONEYBOARD_CONFIG = {
  appName: '우리집 머니보드',

  // Firestore에서 부부 데이터를 묶는 공간 이름
  householdId: 'our-home',

  // Firebase 공동사용 모드
  demoMode: false,

  // 실제 사용할 부부 이메일 2개
allowedEmails: [
  'bgvj90@naver.com',
  'sgersg@naver.com'
],

  firebase: {
    apiKey: 'AIzaSyB5Kp97Lj2AKzUfGymD6wu4cs2HwpAdjus',
    authDomain: 'moneyboart-40746.firebaseapp.com',
    projectId: 'moneyboart-40746',
    storageBucket: 'moneyboart-40746.firebasestorage.app',
    messagingSenderId: '678734932695',
    appId: '1:678734932695:web:f526e92356304c3fb91e92'
  }
};
