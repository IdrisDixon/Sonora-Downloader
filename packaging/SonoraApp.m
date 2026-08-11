#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface SonoraDelegate : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKDownloadDelegate>
@property NSWindow *window;
@property WKWebView *webView;
@property NSTask *server;
@property BOOL ownsServer;
@property NSInteger attempts;
@end

@implementation SonoraDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    [self buildMenu];
    [self buildWindow];
    if ([self serverIsReady]) [self loadPage]; else [self startServer];
}

- (void)buildMenu {
    NSMenu *main = [NSMenu new];
    NSMenuItem *appItem = [NSMenuItem new];
    [main addItem:appItem];
    NSMenu *appMenu = [NSMenu new];
    [appMenu addItemWithTitle:@"关于 Sonora" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"退出 Sonora" action:@selector(terminate:) keyEquivalent:@"q"];
    appItem.submenu = appMenu;

    NSMenuItem *editItem = [NSMenuItem new];
    [main addItem:editItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"编辑"];
    [editMenu addItemWithTitle:@"撤销" action:@selector(undo:) keyEquivalent:@"z"];
    [editMenu addItemWithTitle:@"重做" action:@selector(redo:) keyEquivalent:@"Z"];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"剪切" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"复制" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"粘贴" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"全选" action:@selector(selectAll:) keyEquivalent:@"a"];
    editItem.submenu = editMenu;

    NSMenuItem *viewItem = [NSMenuItem new];
    [main addItem:viewItem];
    NSMenu *viewMenu = [[NSMenu alloc] initWithTitle:@"显示"];
    NSMenuItem *reload = [[NSMenuItem alloc] initWithTitle:@"重新载入" action:@selector(reloadPage:) keyEquivalent:@"r"];
    reload.target = self;
    [viewMenu addItem:reload];
    viewItem.submenu = viewMenu;
    NSApp.mainMenu = main;
}

- (void)buildWindow {
    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:config];
    self.webView.navigationDelegate = self;
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
        NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable;
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 920, 720)
                                               styleMask:style backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"Youtube 音频提取";
    self.window.minSize = NSMakeSize(620, 560);
    self.window.contentView = self.webView;
    [self.window center];
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    [self.window makeFirstResponder:self.webView];
}

- (NSString *)nodePath {
    NSString *home = NSHomeDirectory();
    NSArray *paths = @[@"/usr/local/bin/node", @"/opt/homebrew/bin/node",
                       [home stringByAppendingPathComponent:@"homebrew/bin/node"]];
    for (NSString *path in paths)
        if ([[NSFileManager defaultManager] isExecutableFileAtPath:path]) return path;
    return nil;
}

- (void)startServer {
    NSString *resources = NSBundle.mainBundle.resourcePath;
    if (!resources) { [self showError:@"无法读取应用资源。"]; return; }

    NSString *tools = [resources stringByAppendingPathComponent:@"tools"];
    NSString *bundledNode = [tools stringByAppendingPathComponent:@"node"];
    NSString *node = [[NSFileManager defaultManager] isExecutableFileAtPath:bundledNode]
        ? bundledNode : [self nodePath];
    if (!node) { [self showError:@"未找到内置 Node.js，应用可能不完整。"]; return; }

    NSString *appDir = [resources stringByAppendingPathComponent:@"app"];
    NSString *logDir = [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Logs/Sonora"];
    [[NSFileManager defaultManager] createDirectoryAtPath:logDir withIntermediateDirectories:YES attributes:nil error:nil];
    NSString *logPath = [logDir stringByAppendingPathComponent:@"server.log"];
    if (![[NSFileManager defaultManager] fileExistsAtPath:logPath])
        [[NSFileManager defaultManager] createFileAtPath:logPath contents:nil attributes:nil];
    NSFileHandle *log = [NSFileHandle fileHandleForWritingAtPath:logPath];
    [log seekToEndOfFile];

    self.server = [NSTask new];
    self.server.executableURL = [NSURL fileURLWithPath:node];
    self.server.arguments = @[@"server.js"];
    self.server.currentDirectoryURL = [NSURL fileURLWithPath:appDir];
    NSMutableDictionary *env = [NSProcessInfo.processInfo.environment mutableCopy];
    env[@"HOST"] = @"127.0.0.1"; env[@"PORT"] = @"3000";
    NSString *ytdlp = [tools stringByAppendingPathComponent:@"yt-dlp"];
    NSString *ffmpeg = [tools stringByAppendingPathComponent:@"ffmpeg"];
    if ([[NSFileManager defaultManager] isExecutableFileAtPath:ytdlp]) env[@"SONORA_YTDLP"] = ytdlp;
    if ([[NSFileManager defaultManager] isExecutableFileAtPath:ffmpeg]) env[@"SONORA_FFMPEG"] = ffmpeg;
    self.server.environment = env;
    self.server.standardOutput = log; self.server.standardError = log;
    NSError *error = nil;
    if (![self.server launchAndReturnError:&error]) {
        [self showError:[NSString stringWithFormat:@"服务启动失败：%@", error.localizedDescription]];
        return;
    }
    self.ownsServer = YES;
    self.attempts = 0;
    [self waitForServer];
}

- (BOOL)serverIsReady {
    NSData *data = [NSData dataWithContentsOfURL:[NSURL URLWithString:@"http://127.0.0.1:3000"]];
    return data.length > 0;
}

- (void)waitForServer {
    if ([self serverIsReady]) { [self loadPage]; return; }
    if (++self.attempts >= 60 || (self.server && !self.server.running)) {
        [self showError:@"本地服务启动失败，请查看 ~/Library/Logs/Sonora/server.log"];
        return;
    }
    [self performSelector:@selector(waitForServer) withObject:nil afterDelay:0.2];
}

- (void)loadPage {
    NSURLRequest *request = [NSURLRequest requestWithURL:[NSURL URLWithString:@"http://127.0.0.1:3000"]
                                             cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:10];
    [self.webView loadRequest:request];
    [self.window makeKeyAndOrderFront:nil];
    [self.window makeFirstResponder:self.webView];
}

- (void)reloadPage:(id)sender { [self.webView reloadFromOrigin]; }

- (void)webView:(WKWebView *)webView
    decidePolicyForNavigationResponse:(WKNavigationResponse *)navigationResponse
                     decisionHandler:(void (^)(WKNavigationResponsePolicy))decisionHandler {
    NSHTTPURLResponse *response = (NSHTTPURLResponse *)navigationResponse.response;
    NSString *disposition = response.allHeaderFields[@"Content-Disposition"];
    BOOL isAttachment = [disposition.lowercaseString containsString:@"attachment"];
    if (isAttachment || !navigationResponse.canShowMIMEType) {
        decisionHandler(WKNavigationResponsePolicyDownload);
    } else {
        decisionHandler(WKNavigationResponsePolicyAllow);
    }
}

- (void)webView:(WKWebView *)webView
 navigationResponse:(WKNavigationResponse *)navigationResponse
      didBecomeDownload:(WKDownload *)download API_AVAILABLE(macos(11.3)) {
    download.delegate = self;
}

- (void)download:(WKDownload *)download
    decideDestinationUsingResponse:(NSURLResponse *)response
                 suggestedFilename:(NSString *)suggestedFilename
                 completionHandler:(void (^)(NSURL * _Nullable destination))completionHandler API_AVAILABLE(macos(11.3)) {
    NSSavePanel *panel = [NSSavePanel savePanel];
    panel.nameFieldStringValue = suggestedFilename.length ? suggestedFilename : @"audio.mp3";
    panel.canCreateDirectories = YES;
    panel.title = @"保存音频";
    if ([panel runModal] == NSModalResponseOK) completionHandler(panel.URL);
    else completionHandler(nil);
}

- (void)downloadDidFinish:(WKDownload *)download API_AVAILABLE(macos(11.3)) {
    NSUserNotification *notice = [NSUserNotification new];
    notice.title = @"Sonora";
    notice.informativeText = @"音频已保存";
    [[NSUserNotificationCenter defaultUserNotificationCenter] deliverNotification:notice];
}

- (void)download:(WKDownload *)download
 didFailWithError:(NSError *)error
       resumeData:(NSData *)resumeData API_AVAILABLE(macos(11.3)) {
    if (error.code == NSUserCancelledError) return;
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"保存失败";
    alert.informativeText = error.localizedDescription;
    alert.alertStyle = NSAlertStyleWarning;
    [alert runModal];
}

- (void)showError:(NSString *)message {
    NSAlert *alert = [NSAlert new];
    alert.messageText = @"Sonora 无法启动";
    alert.informativeText = message;
    alert.alertStyle = NSAlertStyleCritical;
    [alert addButtonWithTitle:@"退出"];
    [alert runModal];
    [NSApp terminate:nil];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return YES; }

- (void)applicationWillTerminate:(NSNotification *)notification {
    if (self.ownsServer && self.server.running) {
        [self.server terminate];
        [self.server waitUntilExit];
    }
}
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *app = NSApplication.sharedApplication;
        SonoraDelegate *delegate = [SonoraDelegate new];
        app.delegate = delegate;
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        [app run];
    }
    return 0;
}
