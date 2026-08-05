// ตัวช่วยของ Vex: ลิสต์หน้าต่างทุก Space (เจ้าของใช้หลายเดสก์ท็อป)
//
// ทำไมต้องมี: `screencapture` เก็บได้แค่ Space ที่แสดงอยู่บนจอหลัก
// เจ้าของจัด Warp ไว้อีก Space → ภาพ "หลักฐาน" ทุกใบกลายเป็นของ Chrome ทั้งที่คำสั่งรันสำเร็จ
// (เจอจริง 5 ส.ค. 2026 — ระบบรายงานว่า "ส่งไม่สำเร็จ" ทั้งที่ไฟล์ token ถูกเขียนแล้ว)
//
// CGWindowListCopyWindowInfo(kCGWindowListOptionAll) เห็นหน้าต่างทุก Space
// ได้ window id มาแล้วใช้ `screencapture -l <id>` แคปข้าม Space ได้เลย
//
// ทำไมเป็นภาษา C: JXA เรียก CGWindowListCopyWindowInfo ไม่ได้ (ไม่มีใน bridge)
// pyobjc ไม่ได้ติดตั้ง · swift toolchain ในเครื่องไม่แมตช์กับ SDK (redefinition of SwiftBridging)
// clang กับ CoreGraphics ที่เป็น C API ล้วนคือทางที่เหลือและง่ายที่สุด

#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <string.h>

static void jstr(const char *s) {
  putchar('"');
  for (const char *p = s; *p; p++) {
    if (*p == '"' || *p == '\\') { putchar('\\'); putchar(*p); }
    else if ((unsigned char)*p < 0x20) printf("\\u%04x", *p);
    else putchar(*p);
  }
  putchar('"');
}
static void cf2c(CFStringRef s, char *buf, size_t n) {
  buf[0] = 0;
  if (s) CFStringGetCString(s, buf, n, kCFStringEncodingUTF8);
}
int main(void) {
  CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionAll | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
  if (!list) { printf("[]\n"); return 0; }
  printf("[");
  int first = 1;
  for (CFIndex i = 0; i < CFArrayGetCount(list); i++) {
    CFDictionaryRef w = CFArrayGetValueAtIndex(list, i);
    int layer = 0;
    CFNumberRef ln = CFDictionaryGetValue(w, kCGWindowLayer);
    if (ln) CFNumberGetValue(ln, kCFNumberIntType, &layer);
    if (layer != 0) continue;
    CFDictionaryRef bd = CFDictionaryGetValue(w, kCGWindowBounds);
    if (!bd) continue;
    CGRect r;
    if (!CGRectMakeWithDictionaryRepresentation(bd, &r)) continue;
    if (r.size.width <= 200 || r.size.height <= 200) continue;
    int wid = 0;
    CFNumberRef idn = CFDictionaryGetValue(w, kCGWindowNumber);
    if (idn) CFNumberGetValue(idn, kCFNumberIntType, &wid);
    char app[256], name[256];
    cf2c(CFDictionaryGetValue(w, kCGWindowOwnerName), app, sizeof app);
    cf2c(CFDictionaryGetValue(w, kCGWindowName), name, sizeof name);
    if (!first) printf(",");
    first = 0;
    printf("{\"id\":%d,\"app\":", wid); jstr(app);
    printf(",\"name\":"); jstr(name);
    printf(",\"w\":%d,\"h\":%d}", (int)r.size.width, (int)r.size.height);
  }
  printf("]\n");
  CFRelease(list);
  return 0;
}
