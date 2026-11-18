using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.RateLimiting;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    EnvironmentName = Environments.Development
});

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.SetIsOriginAllowed(origin =>
        {
            if (string.IsNullOrEmpty(origin)) return false;
            try
            {
                var uri = new Uri(origin);
                return uri.Host == "localhost" || uri.Host == "127.0.0.1";
            }
            catch
            {
                return false;
            }
        })
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials();
    });
});

builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "EduShield.Lab.Session";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest; // HTTPS in production.
        options.ExpireTimeSpan = TimeSpan.FromMinutes(30);
        options.SlidingExpiration = true;
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return Task.CompletedTask;
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-XSRF-TOKEN";
    options.Cookie.Name = "EduShield.Lab.Antiforgery";
    options.Cookie.SameSite = SameSiteMode.Lax;
    options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    options.Cookie.HttpOnly = true;
});
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddFixedWindowLimiter("demo-login", limiter =>
    {
        limiter.PermitLimit = 30;
        limiter.Window = TimeSpan.FromMinutes(1);
        limiter.QueueLimit = 0;
        limiter.AutoReplenishment = true;
    });
});

var app = builder.Build();

app.UseCors();

app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["Cache-Control"] = "private, no-store";
    await next(context);
});

app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.UseAntiforgery();

app.MapGet("/api/security/csrf", (HttpContext context, IAntiforgery antiforgery) =>
{
    var tokenSet = antiforgery.GetAndStoreTokens(context);
    context.Response.Cookies.Append("XSRF-TOKEN", tokenSet.RequestToken!, new CookieOptions
    {
        HttpOnly = false, // Angular must read it for its XSRF header.
        Secure = context.Request.IsHttps,
        SameSite = SameSiteMode.Strict,
        Path = "/",
    });
    return Results.Ok(new { ready = true });
});

app.MapGet("/api/auth/me", (ClaimsPrincipal user) =>
    user.Identity?.IsAuthenticated == true
        ? Results.Ok(new { username = user.Identity.Name })
        : Results.Unauthorized());

app.MapPost("/api/auth/login", async (
    LoginRequest input,
    HttpContext context,
    IConfiguration config) =>
{
    var password = config["Demo:Password"] ?? "LabOnly_2026!";

    // Demo-only account. Do not reuse in production; use Identity + password hashing.
    var expectedHash = SHA256.HashData(Encoding.UTF8.GetBytes(password));
    var givenHash = SHA256.HashData(Encoding.UTF8.GetBytes(input.Password ?? ""));
    var passwordValid = CryptographicOperations.FixedTimeEquals(expectedHash, givenHash);
    if (!string.Equals(input.Username, "student", StringComparison.Ordinal) || !passwordValid)
        return Results.Json(new { message = "Incorrect demo credentials." }, statusCode: 401);

    var claims = new[]
    {
        new Claim(ClaimTypes.NameIdentifier, "student-lab-001"),
        new Claim(ClaimTypes.Name, "student"),
        new Claim(ClaimTypes.Role, "Student"),
    };
    var identity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);
    await context.SignInAsync(
        CookieAuthenticationDefaults.AuthenticationScheme,
        new ClaimsPrincipal(identity));
    return Results.Ok(new { username = "student" });
}).DisableAntiforgery().RequireRateLimiting("demo-login");

app.MapPost("/api/auth/logout", async (HttpContext context) =>
{
    await context.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
    return Results.Ok(new { loggedOut = true });
}).DisableAntiforgery().RequireAuthorization();

// This route protects the file from unauthenticated requests. It is NOT DRM.
// Authenticated users / download extensions can still extract the MP4 bytes if not using DRM.
app.MapGet("/api/lesson/demo-video", (IWebHostEnvironment environment, HttpResponse response) =>
{
    response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
    response.Headers["Pragma"] = "no-cache";
    response.Headers["Content-Disposition"] = "inline; filename=\"stream.dat\"";
    response.Headers["X-Content-Type-Options"] = "nosniff";

    var path = Path.Combine(environment.ContentRootPath, "Assets", "demo.mp4");
    if (!File.Exists(path))
    {
        path = Path.Combine(AppContext.BaseDirectory, "Assets", "demo.mp4");
    }
    if (!File.Exists(path))
    {
        path = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "Assets", "demo.mp4");
    }
    return Results.File(path, contentType: "video/mp4", enableRangeProcessing: true);
}).RequireAuthorization();

app.MapPost("/api/player/launch", (IWebHostEnvironment environment) =>
{
    try
    {
        var searchDirs = new[]
        {
            environment.ContentRootPath,
            Path.GetFullPath(Path.Combine(environment.ContentRootPath, "..")),
            AppContext.BaseDirectory,
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..")),
            Directory.GetCurrentDirectory()
        };

        string? batPath = null;
        foreach (var dir in searchDirs)
        {
            var candidate = Path.Combine(dir, "start-desktop.bat");
            if (File.Exists(candidate))
            {
                batPath = candidate;
                break;
            }
        }

        if (batPath == null)
        {
            return Results.NotFound(new { message = "start-desktop.bat not found." });
        }

        var processInfo = new System.Diagnostics.ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c \"{batPath}\"",
            WorkingDirectory = Path.GetDirectoryName(batPath),
            UseShellExecute = true,
            CreateNoWindow = true
        };
        System.Diagnostics.Process.Start(processInfo);

        return Results.Ok(new { launched = true, message = "Desktop player launch requested." });
    }
    catch (Exception ex)
    {
        return Results.Problem($"Failed to launch Desktop Player: {ex.Message}", statusCode: 500);
    }
}).DisableAntiforgery();

app.MapGet("/api/system/status", () => Results.Ok(new
{
    backend = "ASP.NET Core 10",
    mode = "Development-only educational lab",
    drm = false,
    extensionDetection = false,
    osScreenCaptureBlocking = false,
}));

app.Run();

internal sealed record LoginRequest(string? Username, string? Password);
