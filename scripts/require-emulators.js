if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('The Firestore emulator must be running for security rules tests.');
  console.error('Run: npx firebase-tools emulators:exec --only firestore --project demo-foodbridge-pk "npm run test:rules"');
  process.exit(1);
}
