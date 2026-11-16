import { Component, HostListener, OnDestroy, OnInit, ViewChild, ElementRef, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

type LoginResponse = { username: string };

type TestRow = { id: string; name: string; summary: string; kind: 'active' | 'limited' | 'blocked' | 'desktop' };

type SecurityEvent = { time: string; event: string; badge: string };

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent implements OnInit, OnDestroy {
  @ViewChild('videoEl') videoElement?: ElementRef<HTMLVideoElement>;

  private readonly http = inject(HttpClient);
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private watermarkTimer: ReturnType<typeof setInterval> | null = null;
  private devToolsTimer: ReturnType<typeof setInterval> | null = null;
  private recordingTimer: ReturnType<typeof setTimeout> | null = null;
  private extensionObserver: MutationObserver | null = null;
  private extensionCheckTimer: ReturnType<typeof setInterval> | null = null;
  private activeStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private previewObjectUrl: string | null = null;
  private blobObjectUrl: string | null = null;

  readonly currentUser = signal<string | null>(null);
  readonly csrfReady = signal(false);
  readonly busy = signal(false);
  readonly note = signal('ابدأ بتسجيل الدخول التجريبي لعرض المحاضرة واختبار دروع الحماية الصارمة.');
  readonly blurMode = signal(true);
  readonly antiCaptureMode = signal(true);
  readonly strictMouseLeave = signal(false);
  readonly contentHidden = signal(false);

  // Blackout State
  readonly blackoutActive = signal(false);
  readonly blackoutReason = signal('');
  readonly captureAttemptDetected = signal(false);

  // Persistent Block States
  readonly isRecorderRunning = signal(false);
  readonly activeRecorderName = signal<string | null>(null);
  readonly isExtensionRunning = signal(false);
  readonly extensionDetail = signal<string | null>(null);

  readonly devToolsDetected = signal(false);
  readonly useBlobProtection = signal(false);
  readonly blobLoading = signal(false);
  readonly recording = signal(false);
  readonly recordedPreview = signal<string | null>(null);
  readonly clock = signal(new Date().toLocaleTimeString('ar-JO'));
  readonly drmStatus = signal('لم يتم الفحص');
  readonly showPassword = signal(false);
  readonly isDesktopApp = signal(typeof window !== 'undefined' && !!(window as unknown as { electronShield?: { isElectron?: boolean } }).electronShield?.isElectron);

  // Dynamic floating watermark positions
  readonly watermarkX = signal(14);
  readonly watermarkY = signal(18);

  // Security statistics & logs
  readonly blockedCaptureCount = signal(0);
  readonly clipboardScrubCount = signal(0);
  readonly securityEvents = signal<SecurityEvent[]>([]);

  readonly demoUsername = 'student';
  readonly demoPassword = 'LabOnly_2026!';
  username = this.demoUsername;
  password = this.demoPassword;
  readonly videoSource = '/api/lesson/demo-video';
  readonly activeVideoSrc = signal(this.videoSource);

  readonly tests: TestRow[] = [
    { id: 'screen', name: 'شاشة سوداء دائمة عند تشغيل Screen Recorder', summary: 'رصد OBS وSnipping Tool وبرامج التسجيل وقفل الشاشة باللون الأسود حتى يتم إغلاق البرنامج نهائياً.', kind: 'active' },
    { id: 'extension', name: 'حظر وتشويش إضافات المتصفح (Extensions)', summary: 'فحص حقن كود الإضافات ومسار الـ DOM وقفل الشاشة باللون الأسود حتى إزالة/تعطيل الإضافة.', kind: 'active' },
    { id: 'blur', name: 'كشف فقدان تركيز النافذة (Window Blur)', summary: 'عند فتح أي أداة تصوير خارجية أو تبديل النافذة، يتحول الموقع بالكامل إلى شاشة سوداء ويتوقف الفيديو.', kind: 'active' },
    { id: 'blob', name: 'حماية الذاكرة (In-Memory Blob Stream)', summary: 'إخفاء مسار MP4 المباشر من الـ DOM بالكامل لمنع إضافات التنزيل من التقاط رابط الفيديو.', kind: 'active' },
    { id: 'desktop', name: 'تطبيق سطح المكتب المحمي (Electron Native WDA)', summary: 'تشغيل التطبيق بقشرة سطح مكتب بـ SetWindowDisplayAffinity التي تفرض شاشة سوداء 100% وبلا إضافات.', kind: 'desktop' },
  ];

  ngOnInit(): void {
    this.setupDesktopBridge();
    this.clockTimer = setInterval(() => this.clock.set(new Date().toLocaleTimeString('ar-JO')), 1000);
    this.startWatermarkMotion();

    if (!this.isDesktopApp()) {
      this.startDevToolsDetection();
      this.setupWebScreenCaptureTrap();
      this.setupExtensionSentinel();
    }

    // Attach Capture-phase listeners to intercept keyboard events before anything else
    window.addEventListener('keydown', this.globalCaptureHandler, { capture: true, passive: false });
    window.addEventListener('keyup', this.globalCaptureHandler, { capture: true, passive: false });
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    void this.initialize();
  }

  ngOnDestroy(): void {
    if (this.clockTimer) clearInterval(this.clockTimer);
    if (this.watermarkTimer) clearInterval(this.watermarkTimer);
    if (this.devToolsTimer) clearInterval(this.devToolsTimer);
    if (this.recordingTimer) clearTimeout(this.recordingTimer);
    if (this.extensionCheckTimer) clearInterval(this.extensionCheckTimer);
    if (this.extensionObserver) this.extensionObserver.disconnect();

    window.removeEventListener('keydown', this.globalCaptureHandler, { capture: true });
    window.removeEventListener('keyup', this.globalCaptureHandler, { capture: true });
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    this.stopRecording();
    if (this.previewObjectUrl) URL.revokeObjectURL(this.previewObjectUrl);
    if (this.blobObjectUrl) URL.revokeObjectURL(this.blobObjectUrl);
  }

  // 1. Desktop Electron IPC Bridge
  private setupDesktopBridge(): void {
    const shield = (window as unknown as { electronShield?: { isElectron?: boolean; onRecorderStatus: (cb: (data: { running: boolean; name?: string }) => void) => void } }).electronShield;
    if (shield?.isElectron) {
      this.isDesktopApp.set(true);
      shield.onRecorderStatus((data) => {
        if (data.running) {
          this.isRecorderRunning.set(true);
          this.activeRecorderName.set(data.name || 'برنامج تسجيل شاشة');
          this.triggerPersistentBlackout(`تم رصد برنامج تسجيل شاشة قيد التشغيل (${data.name}). ستبقى الشاشة سوداء حتى تغلق برنامج التسجيل.`);
        } else {
          this.isRecorderRunning.set(false);
          this.activeRecorderName.set(null);
          if (!this.isExtensionRunning()) {
            this.dismissBlackout();
            this.note.set('تم إغلاق برنامج التسجيل؛ تم إلغاء الشاشة السوداء تلقائياً.');
          }
        }
      });
    }
  }

  // 2. Trap navigator.mediaDevices.getDisplayMedia (browser mode only)
  private setupWebScreenCaptureTrap(): void {
    if (this.isDesktopApp()) return;
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        navigator.mediaDevices.getDisplayMedia = async () => {
          this.isRecorderRunning.set(true);
          this.activeRecorderName.set('Web Tab / Screen Capture API');
          this.triggerPersistentBlackout('تم رصد محاولة تسجيل التبويب أو الشاشة عبر المتصفح. تظل الشاشة سوداء حتى إلغاء التسجيل.');
          throw new DOMException('Recording blocked by EduShield Security Engine.', 'NotAllowedError');
        };
      }
    } catch {}
  }

  // 3. Active Anti-Extension Sentinel (MutationObserver for web browser mode)
  private setupExtensionSentinel(): void {
    // In Electron Desktop App, extensions are 100% disabled natively at engine level
    if (this.isDesktopApp()) return;

    // MutationObserver watching for injected extension elements/scripts
    this.extensionObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of Array.from(m.addedNodes)) {
          if (node instanceof HTMLElement) {
            const html = node.outerHTML || '';
            const isExtensionNode =
              html.includes('chrome-extension://') ||
              html.includes('moz-extension://') ||
              node.id.toLowerCase().includes('idm_') ||
              node.className.toString().toLowerCase().includes('idm_') ||
              html.includes('loom-companion') ||
              html.includes('screencastify') ||
              html.includes('download-helper');

            if (isExtensionNode) {
              this.flagExtensionDetected(`تم رصد كود محقون من إضافة متصفح (Extension Artifact: ${node.id || node.tagName})`);
              return;
            }
          }
        }
      }
    });

    this.extensionObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    // Periodic scan for extension artifacts (only in browser mode)
    this.extensionCheckTimer = setInterval(() => {
      const suspiciousSelectors = [
        '[id*="idm_"]', '[class*="idm_"]',
        '[class*="download-helper"]',
        '#loom-companion-mv3',
        'script[src^="chrome-extension://"]',
        'link[href^="chrome-extension://"]',
        'iframe[src^="chrome-extension://"]'
      ];
      for (const sel of suspiciousSelectors) {
        if (document.querySelector(sel)) {
          this.flagExtensionDetected(`تم رصد إضافة نشطة في DOM (${sel})`);
          break;
        }
      }
    }, 2000);
  }

  flagExtensionDetected(reason: string): void {
    if (this.isDesktopApp()) return;
    this.isExtensionRunning.set(true);
    this.extensionDetail.set(reason);
    this.triggerPersistentBlackout(reason);
  }

  private startWatermarkMotion(): void {
    this.watermarkTimer = setInterval(() => {
      const randomX = Math.floor(Math.random() * 60) + 10;
      const randomY = Math.floor(Math.random() * 65) + 10;
      this.watermarkX.set(randomX);
      this.watermarkY.set(randomY);
    }, 3500);
  }

  private startDevToolsDetection(): void {
    // In Electron Desktop App, devtools are disabled natively at the engine level
    if (this.isDesktopApp()) return;

    this.devToolsTimer = setInterval(() => {
      const threshold = 160;
      const widthDiff = window.outerWidth - window.innerWidth > threshold;
      const heightDiff = window.outerHeight - window.innerHeight > threshold;
      if (widthDiff || heightDiff) {
        if (!this.devToolsDetected() && this.currentUser()) {
          this.devToolsDetected.set(true);
          this.triggerBlackout('تم رصد فتح نافذة أدوات المطورين (DevTools / Console)؛ تم تفعيل الشاشة السوداء لحماية المحتوى.');
        }
      } else {
        if (this.devToolsDetected()) {
          this.devToolsDetected.set(false);
        }
      }
    }, 1200);
  }

  // Global Capture-phase handler for aggressive interception
  private readonly globalCaptureHandler = (event: Event): void => {
    if (!this.antiCaptureMode()) return;

    if (event instanceof KeyboardEvent) {
      // 1. PrintScreen key
      if (
        event.key === 'PrintScreen' ||
        event.code === 'PrintScreen' ||
        event.keyCode === 44 ||
        event.which === 44
      ) {
        event.preventDefault();
        event.stopPropagation();
        this.captureAttemptDetected.set(true);
        this.triggerBlackout('تم رصد الضغط على زر تصوير الشاشة (PrintScreen)');
        this.scrubClipboard();
        return;
      }

      // 2. Windows Snipping Tool (Meta+Shift+S / Win+Shift+S / Alt+PrintScreen)
      if (
        (event.shiftKey && (event.key === 'S' || event.key === 's') && (event.metaKey || event.altKey)) ||
        (event.altKey && (event.key === 'PrintScreen' || event.code === 'PrintScreen'))
      ) {
        event.preventDefault();
        event.stopPropagation();
        this.captureAttemptDetected.set(true);
        this.triggerBlackout('تم رصد محاولة تشغيل أداة لقطة الشاشة (Snipping Tool / Win+Shift+S)');
        this.scrubClipboard();
        return;
      }

      // 3. DevTools shortcuts (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C)
      if (
        event.key === 'F12' ||
        event.keyCode === 123 ||
        (event.ctrlKey && event.shiftKey && ['I', 'i', 'J', 'j', 'C', 'c'].includes(event.key))
      ) {
        event.preventDefault();
        event.stopPropagation();
        this.triggerBlackout('تم حظر اختصار فتح أدوات المطورين (DevTools)');
        return;
      }

      // 4. View Source (Ctrl+U)
      if (event.ctrlKey && (event.key === 'u' || event.key === 'U')) {
        event.preventDefault();
        event.stopPropagation();
        this.triggerBlackout('تم حظر محاولة عرض كود المصدر (Ctrl+U)');
        return;
      }

      // 5. Save Page / Video (Ctrl+S)
      if (event.ctrlKey && (event.key === 's' || event.key === 'S')) {
        event.preventDefault();
        event.stopPropagation();
        this.triggerBlackout('تم حظر محاولة حفظ وتنزيل الفيديو (Ctrl+S)');
        return;
      }

      // 6. Print Page (Ctrl+P)
      if (event.ctrlKey && (event.key === 'p' || event.key === 'P')) {
        event.preventDefault();
        event.stopPropagation();
        this.triggerBlackout('تم حظر محاولة طباعة الصفحة أو حفظها كـ PDF (Ctrl+P)');
        return;
      }
    }
  };

  private readonly onVisibilityChange = (): void => {
    // Only protect when student is logged in and viewing content
    if (!this.currentUser()) return;

    if (document.hidden) {
      if (this.blurMode() || this.antiCaptureMode()) {
        this.captureAttemptDetected.set(true);
        this.triggerBlackout('تم تصغير النافذة أو الانتقال لتبويب آخر (تم تفعيل الشاشة السوداء لحماية المحتوى).');
      }
    } else {
      if (!this.blackoutActive() && !this.isRecorderRunning() && !this.isExtensionRunning()) {
        this.contentHidden.set(false);
      }
    }
  };

  readonly videoErrorMessage = signal<string | null>(null);

  onVideoError(event: Event): void {
    const video = event.target as HTMLVideoElement;
    console.error('[EduShield] Video playback error:', video?.error);
    const code = video?.error?.code;
    const msg = code === 1 ? 'تم إلغاء تحميل الفيديو' :
                code === 2 ? 'خطأ في شبكة الاتصال بالسيرفر' :
                code === 3 ? 'تعذر فك ترميز ملف الفيديو' :
                code === 4 ? 'تعذر تشغيل الفيديو: تأكد من تسجيل الدخول واتصال السيرفر (منفذ 5078)' :
                'خطأ في تشغيل الفيديو';
    this.videoErrorMessage.set(msg);
    this.note.set(msg);
  }

  @HostListener('window:blur')
  onWindowBlur(): void {
    if (!this.currentUser()) return;
    // In Desktop App, hardware WDA_MONITOR protects the window at OS level; no need to annoy user on blur
    if (this.isDesktopApp()) return;

    if (this.blurMode() || this.antiCaptureMode()) {
      this.captureAttemptDetected.set(true);
      this.triggerBlackout('فقدت نافذة المتصفح التركيز (محتمل تشغيل أداة لقطة شاشة Snipping Tool أو برنامج خارجي)');
    }
  }

  @HostListener('window:focus')
  onWindowFocus(): void {
    if (this.captureAttemptDetected() || this.blackoutActive()) {
      this.scrubClipboard();
      setTimeout(() => this.scrubClipboard(), 150);
      setTimeout(() => this.scrubClipboard(), 450);
      setTimeout(() => this.scrubClipboard(), 900);
    }

    if (!document.hidden && !this.blackoutActive() && !this.isRecorderRunning() && !this.isExtensionRunning()) {
      this.contentHidden.set(false);
    }
  }

  @HostListener('document:mouseleave')
  onMouseLeave(): void {
    if (this.strictMouseLeave() && this.currentUser()) {
      this.triggerBlackout('خرج مؤشر الفأرة من إطار نافذة المتصفح (حماية من أدوات القص والتسجيل الخارجية).');
    }
  }

  triggerBlackout(reason: string): void {
    if (!this.currentUser()) return;
    this.blackoutActive.set(true);
    this.blackoutReason.set(reason);
    this.blockedCaptureCount.update(c => c + 1);
    this.pauseVideo();

    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.style.filter = 'brightness(0)';
    }

    const time = new Date().toLocaleTimeString('ar-JO');
    this.securityEvents.update(list => [{ time, event: reason, badge: 'حظر' }, ...list.slice(0, 14)]);
  }

  triggerPersistentBlackout(reason: string): void {
    this.blackoutActive.set(true);
    this.blackoutReason.set(reason);
    this.pauseVideo();
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.style.filter = 'brightness(0)';
    }
  }

  dismissBlackout(): void {
    // If a recorder or extension is actively flagged, DO NOT allow dismissal!
    if (this.isRecorderRunning()) {
      this.note.set(`لا يمكن إلغاء الشاشة السوداء: برنامج التسجيل (${this.activeRecorderName()}) لا يزال يعمل في الخلفية!`);
      return;
    }
    if (this.isExtensionRunning()) {
      this.note.set('لا يمكن إلغاء الشاشة السوداء: هناك إضافة متصفح نشطة تمنع تشغيل الفيديو!');
      return;
    }

    this.blackoutActive.set(false);
    this.blackoutReason.set('');
    this.captureAttemptDetected.set(false);
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.style.filter = 'none';
    }
  }

  // Simulations for testing
  toggleRecorderSimulation(): void {
    if (this.isRecorderRunning()) {
      this.isRecorderRunning.set(false);
      this.activeRecorderName.set(null);
      this.dismissBlackout();
      this.note.set('تمت محاكاة إيقاف وإغلاق برنامج التسجيل؛ عادت الشاشة للعمل.');
    } else {
      this.isRecorderRunning.set(true);
      this.activeRecorderName.set('OBS Studio (محاكاة)');
      this.triggerPersistentBlackout('تم رصد تشغيل برنامج سكرين ريكورد (OBS Studio). ستبقى الشاشة سوداء تماماً حتى يتم إيقاف وإغلاق البرنامج!');
    }
  }

  toggleExtensionSimulation(): void {
    if (this.isExtensionRunning()) {
      this.isExtensionRunning.set(false);
      this.extensionDetail.set(null);
      this.dismissBlackout();
      this.note.set('تمت محاكاة إزالة/تعطيل الإضافة؛ عادت الشاشة للعمل.');
    } else {
      this.isExtensionRunning.set(true);
      this.extensionDetail.set('Video DownloadHelper Extension (محاكاة)');
      this.triggerPersistentBlackout('تم رصد إضافة تنزيل فيديو (Extension). يمنع النظام تشغيل أي إضافات؛ ستبقى الشاشة سوداء حتى إزالة الإضافة!');
    }
  }

  simulateScreenshotTest(): void {
    this.captureAttemptDetected.set(true);
    this.triggerBlackout('اختبار يدوي: تم رصد محاكاة لقطة شاشة وتفعيل الشاشة السوداء الكاملة.');
    this.scrubClipboard();
  }

  private pauseVideo(): void {
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.pause();
    }
  }

  scrubClipboard(): void {
    if (navigator.clipboard?.writeText) {
      const user = this.currentUser() || 'طالب';
      const time = new Date().toLocaleString('ar-JO');
      navigator.clipboard.writeText(
        `⚠️ تنبيه أمني من EduShield: محتوى هذه المحاضرة محمي بحقوق الملكية الفكرية. تم رصد محاولة التقاط الشاشة للحساب (${user}) في تاريخ ${time}. يُمنع تسريب أو تداول هذا المحتوى.`
      ).catch(() => {});
      this.clipboardScrubCount.update(c => c + 1);
    }
  }

  async toggleBlobProtection(): Promise<void> {
    if (this.useBlobProtection()) {
      this.useBlobProtection.set(false);
      this.activeVideoSrc.set(this.videoSource);
      if (this.blobObjectUrl) {
        URL.revokeObjectURL(this.blobObjectUrl);
        this.blobObjectUrl = null;
      }
      this.note.set('تمت العودة إلى وضع البث المباشر المعتاد.');
      return;
    }

    if (!this.currentUser()) {
      this.note.set('يجب تسجيل الدخول أولاً لتفعيل حماية الذاكرة (In-Memory Blob).');
      return;
    }

    this.blobLoading.set(true);
    this.note.set('جاري سحب الفيديو وتشفيره في ذاكرة المتصفح (In-Memory Blob Stream)...');
    try {
      const blob = await firstValueFrom(
        this.http.get(this.videoSource, { responseType: 'blob' })
      );
      if (this.blobObjectUrl) URL.revokeObjectURL(this.blobObjectUrl);
      this.blobObjectUrl = URL.createObjectURL(blob);
      this.activeVideoSrc.set(this.blobObjectUrl);
      this.useBlobProtection.set(true);
      this.note.set('تم تفعيل حماية الذاكرة بنجاح: تم إخفاء مسار MP4 المباشر وتحويله لكائن Blob مؤقت لمنع إضافات التحميل البسيطة.');
    } catch {
      this.note.set('تعذر جلب الفيديو في الذاكرة. تأكد من عمل السيرفر وجلسة الدخول.');
    } finally {
      this.blobLoading.set(false);
    }
  }

  setBlurMode(enabled: boolean): void {
    this.blurMode.set(enabled);
    if (!enabled && !this.blackoutActive()) this.contentHidden.set(false);
    else if (enabled) this.contentHidden.set(document.hidden || !document.hasFocus());
  }

  setAntiCaptureMode(enabled: boolean): void {
    this.antiCaptureMode.set(enabled);
    if (!enabled) this.dismissBlackout();
  }

  setStrictMouseLeave(enabled: boolean): void {
    this.strictMouseLeave.set(enabled);
  }

  private async initialize(retryCount = 0): Promise<void> {
    try {
      await firstValueFrom(this.http.get('/api/security/csrf'));
      this.csrfReady.set(true);
      const user = await firstValueFrom(this.http.get<LoginResponse>('/api/auth/me'));
      this.currentUser.set(user.username);
      this.note.set('تمت استعادة جلسة الدخول بنجاح. المحاضرة ودروع الحماية جاهزة.');
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.csrfReady.set(true);
        this.note.set('يمكنك الآن تسجيل الدخول التجريبي لتفعيل المحاضرة.');
        if (this.isDesktopApp()) {
          setTimeout(() => { void this.login(); }, 150);
        }
      } else {
        if (retryCount < 5) {
          this.note.set(`جاري الاتصال بالخادم الأمني على المنفذ 5078 (محاولة ${retryCount + 1}/5)...`);
          setTimeout(() => { void this.initialize(retryCount + 1); }, 1200);
        } else {
          this.note.set('تعذر الاتصال بالخادم (5078). تأكد من تشغيل start-backend.bat ثم اضغط زر الدخول للمحاولة.');
        }
      }
    }
  }

  async login(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.note.set('جاري تسجيل الدخول والتحقق من الحماية...');
    try {
      if (!this.csrfReady()) {
        try {
          await firstValueFrom(this.http.get('/api/security/csrf'));
          this.csrfReady.set(true);
        } catch {}
      }
      const response = await firstValueFrom(this.http.post<LoginResponse>('/api/auth/login', {
        username: this.username,
        password: this.password,
      }));
      this.currentUser.set(response.username);
      this.note.set('تم تسجيل الدخول بنجاح! المحاضرة والمشغل جاهزان للعرض.');
    } catch (error: any) {
      console.error('[EduShield Login Error]', JSON.stringify({
        status: error?.status,
        statusText: error?.statusText,
        message: error?.message,
        body: error?.error
      }));
      if (error instanceof HttpErrorResponse) {
        if (error.status === 429) {
          this.note.set('محاولات كثيرة، يرجى الانتظار دقيقة والمحاولة مجدداً.');
        } else if (error.status === 400) {
          this.note.set('رمز الحماية (CSRF) غير متطابق؛ اضغط الزر مرة أخرى للتحديث.');
          this.csrfReady.set(false);
        } else if (error.status === 502 || error.status === 0) {
          this.note.set('خادم الـ Backend غير متصل على منفذ 5078. تأكد من نافذة start-backend.bat.');
        } else {
          this.note.set(`فشل الدخول (رمز ${error.status}): تأكد من تشغيل الباك إند.`);
        }
      } else {
        this.note.set('حدث خطأ أثناء الاتصال بالخادم.');
      }
    } finally {
      this.busy.set(false);
    }
  }

  async logout(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.post('/api/auth/logout', {}));
      this.currentUser.set(null);
      if (this.blobObjectUrl) {
        URL.revokeObjectURL(this.blobObjectUrl);
        this.blobObjectUrl = null;
      }
      this.useBlobProtection.set(false);
      this.activeVideoSrc.set(this.videoSource);
      this.dismissBlackout();
      this.note.set('تم تسجيل الخروج بنجاح. تم إغلاق الجلسة وإبطال الوصول.');
    } catch {
      this.note.set('تعذر تسجيل الخروج؛ افحصي اتصال السيرفر.');
    } finally {
      this.busy.set(false);
    }
  }

  disableContextMenu(event: MouseEvent): void {
    event.preventDefault();
    this.triggerBlackout('تم حظر النقر بزر الفأرة الأيمن (Context Menu) لمنع خيارات التنزيل والحفظ.');
  }

  async checkDrmApi(): Promise<void> {
    if (!('requestMediaKeySystemAccess' in navigator)) {
      this.drmStatus.set('Encrypted Media Extensions غير متاحة هنا.');
      return;
    }
    this.drmStatus.set('جاري فحص واجهة EME...');
    const configurations: MediaKeySystemConfiguration[] = [{
      initDataTypes: ['cenc'],
      audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
      videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }],
      distinctiveIdentifier: 'not-allowed',
      persistentState: 'not-allowed',
      sessionTypes: ['temporary'],
    }];
    const candidates = [
      ['Widevine', 'com.widevine.alpha'],
      ['PlayReady', 'com.microsoft.playready'],
    ];
    const supported: string[] = [];
    for (const [label, keySystem] of candidates) {
      try {
        await navigator.requestMediaKeySystemAccess(keySystem, configurations);
        supported.push(label);
      } catch { /* Rejection is expected on unsupported browsers/platforms. */ }
    }
    this.drmStatus.set(supported.length
      ? `EME مرشّح متاح: ${supported.join('، ')}. هذا الأساس المستخدم للشاشات السوداء العتادية الحقيقية.`
      : 'لا يوجد دعم مثبت بهذه الإعدادات. Safari/FairPlay يحتاج مزود تراخيص خاص.');
  }

  async recordCurrentTab(): Promise<void> {
    if (this.recording()) return;
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
      this.note.set('تسجيل التبويب عبر Browser API غير مدعوم في هذا المتصفح. اختبري أداة نظام التشغيل يدويًا.');
      return;
    }
    try {
      this.note.set('اختاري تبويب EduShield فقط من نافذة المشاركة. لا تختاري سطح المكتب كاملًا.');
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const setting = stream.getVideoTracks()[0]?.getSettings() as MediaTrackSettings & { displaySurface?: string };
      if (setting?.displaySurface !== 'browser') {
        stream.getTracks().forEach(track => track.stop());
        this.note.set('تم إلغاء التجربة: يُسمح بتسجيل تبويب المتصفح فقط، وليس الشاشة الكاملة أو النوافذ.');
        return;
      }
      this.activeStream = stream;
      const chunks: BlobPart[] = [];
      const mime = ['video/webm;codecs=vp9', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      this.recorder = recorder;
      recorder.ondataavailable = event => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        this.activeStream = null;
        this.recording.set(false);
        if (chunks.length) {
          if (this.previewObjectUrl) URL.revokeObjectURL(this.previewObjectUrl);
          this.previewObjectUrl = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
          this.recordedPreview.set(this.previewObjectUrl);
          this.note.set('اكتمل الاختبار: التسجيل محلي في ذاكرة المتصفح، ولا يُرفع إلى السيرفر. جرّبي تشغيل المعاينة.');
        }
      };
      stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stopRecording());
      recorder.start(300);
      this.recording.set(true);
      this.recordingTimer = setTimeout(() => this.stopRecording(), 4000);
      this.note.set('بدأ تسجيل التبويب بموافقتك لمدة 4 ثوانٍ. لاحظ كيف يستطيع المتصفح التسجيل الداخلي إلا إذا وجد DRM حقيقي.');
    } catch (error) {
      this.stopRecording();
      this.note.set(error instanceof Error && error.name === 'NotAllowedError'
        ? 'تم إلغاء إذن مشاركة التبويب.'
        : 'تعذر تسجيل التبويب في هذا المتصفح أو هذه البيئة.');
    }
  }

  stopRecording(): void {
    if (this.recordingTimer) { clearTimeout(this.recordingTimer); this.recordingTimer = null; }
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    if (this.activeStream) this.activeStream.getTracks().forEach(track => track.stop());
    this.recording.set(false);
  }
}
