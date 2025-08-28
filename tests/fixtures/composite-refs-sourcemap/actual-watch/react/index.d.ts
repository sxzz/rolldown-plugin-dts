//#region tests/fixtures/composite-refs-sourcemap/src/types.d.ts
type Toast = {
  title: string;
  description?: string;
  duration?: number;
  type: "info" | "success" | "error" | "warning";
  notificationId?: string;
};
type NewExport = {
  added: true;
};
//#endregion
//#region tests/fixtures/composite-refs-sourcemap/src/react/index.d.ts
declare const testValue = 1;
//#endregion
export { type NewExport, type Toast, testValue };