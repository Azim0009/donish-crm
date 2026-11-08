using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Threading.RateLimiting;
using DonishCrm;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);
var isDev = builder.Environment.IsDevelopment() || string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("DATABASE_URL"));

// ---------- База данных ----------
// На Render: DATABASE_URL (postgres://user:pass@host:port/db). Локально — файл SQLite donish.db
var dbUrl = Environment.GetEnvironmentVariable("DATABASE_URL");
builder.Services.AddDbContext<AppDb>(o =>
{
    if (!string.IsNullOrWhiteSpace(dbUrl)) o.UseNpgsql(PgConn(dbUrl));
    else o.UseSqlite("Data Source=donish.db");
});

// ---------- JWT ----------
var jwtKey = Environment.GetEnvironmentVariable("JWT_KEY");
if (string.IsNullOrWhiteSpace(jwtKey))
{
    if (!isDev) throw new InvalidOperationException("Задайте переменную окружения JWT_KEY (32+ символа)");
    jwtKey = "donish-crm-local-dev-key-only-for-localhost-0123456789";
}
if (jwtKey.Length < 32) throw new InvalidOperationException("JWT_KEY должен быть не короче 32 символов");
var signKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.MapInboundClaims = false;
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true, ValidIssuer = "donish-crm",
            ValidateAudience = true, ValidAudience = "donish-crm",
            ValidateLifetime = true, ClockSkew = TimeSpan.FromMinutes(1),
            ValidateIssuerSigningKey = true, IssuerSigningKey = signKey,
            RoleClaimType = "role", NameClaimType = "name",
        };
        // Токен действует, только если пользователь ещё существует и не менял пароль/роль
        o.Events = new JwtBearerEvents
        {
            OnTokenValidated = async ctx =>
            {
                var db = ctx.HttpContext.RequestServices.GetRequiredService<AppDb>();
                var id = int.TryParse(ctx.Principal?.FindFirst("sub")?.Value, out var v) ? v : 0;
                var stamp = ctx.Principal?.FindFirst("stamp")?.Value;
                var u = await db.Users.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
                if (u == null || u.SecurityStamp != stamp) ctx.Fail("Сессия недействительна");
            },
        };
    });
builder.Services.AddAuthorization(o =>
{
    o.AddPolicy("admin", p => p.RequireRole(Roles.Admin));
    o.AddPolicy("staff", p => p.RequireRole(Roles.Admin, Roles.Teacher));
});

// ---------- Ограничение запросов ----------
string Ip(HttpContext c) => c.Connection.RemoteIpAddress?.ToString() ?? "unknown";
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.ContentType = "application/json";
        await ctx.HttpContext.Response.WriteAsync("{\"error\":\"Слишком много попыток. Подождите минуту и попробуйте снова\"}", ct);
    };
    // вход: 5 попыток в минуту с одного IP
    o.AddPolicy("login", c => RateLimitPartition.GetFixedWindowLimiter(Ip(c), _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    // всё остальное: 300 запросов в минуту с одного IP
    o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(c => RateLimitPartition.GetFixedWindowLimiter(Ip(c), _ => new FixedWindowRateLimiterOptions { PermitLimit = 300, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

// ---------- CORS ----------
var origins = (Environment.GetEnvironmentVariable("FRONTEND_URL") ?? "http://localhost:5173")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    .Select(x => x.TrimEnd('/')).ToArray();
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p.WithOrigins(origins).WithHeaders("Content-Type", "Authorization").WithMethods("GET", "POST", "PUT", "DELETE")));
builder.Services.Configure<ForwardedHeadersOptions>(o => { o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto; o.KnownNetworks.Clear(); o.KnownProxies.Clear(); });

var port = Environment.GetEnvironmentVariable("PORT");
if (!string.IsNullOrEmpty(port)) builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = 64 * 1024); // 64 КБ на запрос

var app = builder.Build();

// Ошибки сервера — без технических подробностей наружу
app.UseExceptionHandler(e => e.Run(async ctx =>
{
    var ex = ctx.Features.Get<IExceptionHandlerFeature>()?.Error;
    app.Logger.LogError(ex, "Необработанная ошибка");
    ctx.Response.StatusCode = ex is BadHttpRequestException ? 400 : 500;
    ctx.Response.ContentType = "application/json";
    await ctx.Response.WriteAsync(ex is BadHttpRequestException ? "{\"error\":\"Неверные данные запроса\"}" : "{\"error\":\"Ошибка сервера. Попробуйте ещё раз\"}");
}));
app.UseForwardedHeaders();
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";
    h["X-Frame-Options"] = "DENY";
    h["Referrer-Policy"] = "no-referrer";
    h["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'";
    h["Cache-Control"] = "no-store";
    if (!isDev) h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
    await next();
});
app.UseCors();
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();

// ---------- Создание таблиц + суперадмин ----------
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    db.Database.EnsureCreated();
    // Новые таблицы для уже существующей базы: создаются, только если их ещё нет. Старые данные не трогаются.
    if (db.Database.IsNpgsql())
    {
        db.Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS ""Payments"" (
            ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            ""StudentId"" integer NOT NULL,
            ""StudentName"" text NOT NULL DEFAULT '',
            ""GroupId"" integer NULL,
            ""GroupName"" text NOT NULL DEFAULT '',
            ""Month"" integer NOT NULL,
            ""Amount"" numeric(12,2) NOT NULL,
            ""Method"" text NOT NULL,
            ""PaidAt"" timestamp with time zone NOT NULL,
            ""Note"" text NULL,
            ""CreatedById"" integer NULL,
            ""CreatedAt"" timestamp with time zone NOT NULL);
          CREATE INDEX IF NOT EXISTS ""IX_Payments_StudentId_Month"" ON ""Payments"" (""StudentId"", ""Month"");
          CREATE TABLE IF NOT EXISTS ""AppSettings"" (""Key"" text PRIMARY KEY, ""Value"" text NOT NULL);");
        db.Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS ""Expenses"" (
            ""Id"" integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            ""Category"" text NOT NULL,
            ""Amount"" numeric(12,2) NOT NULL,
            ""Method"" text NOT NULL,
            ""SpentAt"" timestamp with time zone NOT NULL,
            ""TeacherId"" integer NULL,
            ""TeacherName"" text NOT NULL DEFAULT '',
            ""Note"" text NULL,
            ""CreatedById"" integer NULL,
            ""CreatedAt"" timestamp with time zone NOT NULL);
          CREATE INDEX IF NOT EXISTS ""IX_Expenses_SpentAt"" ON ""Expenses"" (""SpentAt"");");
    }
    else
    {
        db.Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS ""Payments"" (
            ""Id"" INTEGER PRIMARY KEY AUTOINCREMENT,
            ""StudentId"" INTEGER NOT NULL,
            ""StudentName"" TEXT NOT NULL DEFAULT '',
            ""GroupId"" INTEGER NULL,
            ""GroupName"" TEXT NOT NULL DEFAULT '',
            ""Month"" INTEGER NOT NULL,
            ""Amount"" TEXT NOT NULL,
            ""Method"" TEXT NOT NULL,
            ""PaidAt"" TEXT NOT NULL,
            ""Note"" TEXT NULL,
            ""CreatedById"" INTEGER NULL,
            ""CreatedAt"" TEXT NOT NULL);");
        db.Database.ExecuteSqlRaw(@"CREATE INDEX IF NOT EXISTS ""IX_Payments_StudentId_Month"" ON ""Payments"" (""StudentId"", ""Month"");");
        db.Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS ""AppSettings"" (""Key"" TEXT NOT NULL PRIMARY KEY, ""Value"" TEXT NOT NULL);");
        db.Database.ExecuteSqlRaw(@"CREATE TABLE IF NOT EXISTS ""Expenses"" (
            ""Id"" INTEGER PRIMARY KEY AUTOINCREMENT,
            ""Category"" TEXT NOT NULL,
            ""Amount"" TEXT NOT NULL,
            ""Method"" TEXT NOT NULL,
            ""SpentAt"" TEXT NOT NULL,
            ""TeacherId"" INTEGER NULL,
            ""TeacherName"" TEXT NOT NULL DEFAULT '',
            ""Note"" TEXT NULL,
            ""CreatedById"" INTEGER NULL,
            ""CreatedAt"" TEXT NOT NULL);");
        db.Database.ExecuteSqlRaw(@"CREATE INDEX IF NOT EXISTS ""IX_Expenses_SpentAt"" ON ""Expenses"" (""SpentAt"");");
    }
    if (!db.Users.Any(u => u.Role == Roles.Admin))
    {
        db.Users.Add(new User
        {
            FullName = Environment.GetEnvironmentVariable("ADMIN_NAME") ?? "Суперадмин",
            Login = (Environment.GetEnvironmentVariable("ADMIN_LOGIN") ?? "Admin").Trim().ToLowerInvariant(),
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(Environment.GetEnvironmentVariable("ADMIN_PASSWORD") ?? "Donish2026", 11),
            Role = Roles.Admin,
        });
        db.SaveChanges();
    }
}

app.MapGet("/", () => Results.Ok(new { name = "CRM Donish API", ok = true }));

// ================= AUTH =================
var dummyHash = BCrypt.Net.BCrypt.HashPassword("timing-guard", 11);
app.MapPost("/api/auth/login", async (LoginDto dto, AppDb db) =>
{
    var login = (dto.Login ?? "").Trim().ToLowerInvariant();
    var pass = dto.Password ?? "";
    if (login.Length is < 3 or > 32 || pass.Length is < 1 or > 128) return Bad("Неверный логин или пароль");
    var u = await db.Users.FirstOrDefaultAsync(x => x.Login == login);
    if (u?.LockedUntil > DateTime.UtcNow)
    {
        var mins = (int)Math.Ceiling((u.LockedUntil.Value - DateTime.UtcNow).TotalMinutes);
        return Bad($"Слишком много неверных попыток. Вход заблокирован на {mins} мин.");
    }
    var ok = BCrypt.Net.BCrypt.Verify(pass, u?.PasswordHash ?? dummyHash); // одинаковое время ответа
    if (u == null || !ok)
    {
        if (u != null)
        {
            u.FailedLogins++;
            if (u.FailedLogins >= 5) { u.LockedUntil = DateTime.UtcNow.AddMinutes(15); u.FailedLogins = 0; }
            await db.SaveChangesAsync();
        }
        return Bad("Неверный логин или пароль");
    }
    if (u.FailedLogins != 0 || u.LockedUntil != null) { u.FailedLogins = 0; u.LockedUntil = null; await db.SaveChangesAsync(); }
    var token = new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(
        issuer: "donish-crm", audience: "donish-crm",
        claims: new[] { new Claim("sub", u.Id.ToString()), new Claim("role", u.Role), new Claim("name", u.FullName), new Claim("stamp", u.SecurityStamp) },
        expires: DateTime.UtcNow.AddDays(7),
        signingCredentials: new SigningCredentials(signKey, SecurityAlgorithms.HmacSha256)));
    return Results.Ok(new { token, user = new { u.Id, u.FullName, u.Login, u.Role } });
}).RequireRateLimiting("login");

app.MapGet("/api/me", async (ClaimsPrincipal me, AppDb db) =>
{
    var u = await db.Users.FindAsync(UserId(me));
    return u == null ? Results.Unauthorized() : Results.Ok(new { u.Id, u.FullName, u.Login, u.Role });
}).RequireAuthorization("staff");

// Изменение своего профиля (имя, логин) — нужен текущий пароль
app.MapPut("/api/me", async (ProfileDto dto, ClaimsPrincipal me, AppDb db) =>
{
    var u = await db.Users.FindAsync(UserId(me));
    if (u == null) return Results.Unauthorized();
    if (!BCrypt.Net.BCrypt.Verify(dto.CurrentPassword ?? "", u.PasswordHash)) return Bad("Текущий пароль неверный");
    var login = (dto.Login ?? "").Trim().ToLowerInvariant();
    if ((V.Name(dto.FullName, "Имя") ?? V.Login(login)) is { } err) return Bad(err);
    if (await db.Users.AnyAsync(x => x.Login == login && x.Id != u.Id)) return Bad("Такой логин уже занят");
    if (u.Login != login) u.SecurityStamp = Guid.NewGuid().ToString("N");
    u.Login = login; u.FullName = V.Clean(dto.FullName);
    await db.SaveChangesAsync();
    return Results.Ok(new { u.Id, u.FullName, u.Login, u.Role });
}).RequireAuthorization("staff").RequireRateLimiting("login");

// Смена своего пароля (админ и учитель)
app.MapPut("/api/me/password", async (PasswordDto dto, ClaimsPrincipal me, AppDb db) =>
{
    var u = await db.Users.FindAsync(UserId(me));
    if (u == null) return Results.Unauthorized();
    if (!BCrypt.Net.BCrypt.Verify(dto.OldPassword ?? "", u.PasswordHash)) return Bad("Текущий пароль неверный");
    if (dto.NewPassword == dto.OldPassword) return Bad("Новый пароль должен отличаться от старого");
    if (V.Password(dto.NewPassword) is { } e) return Bad(e);
    u.PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.NewPassword, 11);
    u.SecurityStamp = Guid.NewGuid().ToString("N");
    await db.SaveChangesAsync();
    return Results.Ok();
}).RequireAuthorization("staff").RequireRateLimiting("login");

// ================= TEACHERS (только суперадмин) =================
var teachers = app.MapGroup("/api/teachers").RequireAuthorization("admin");
teachers.MapGet("", async (AppDb db) =>
    await db.Users.Where(u => u.Role == Roles.Teacher).OrderBy(u => u.FullName)
        .Select(u => new { u.Id, u.FullName, u.Login, u.Phone, groups = db.Groups.Count(g => g.TeacherId == u.Id) })
        .ToListAsync());

teachers.MapPost("", async (TeacherDto dto, AppDb db) =>
{
    var login = (dto.Login ?? "").Trim().ToLowerInvariant();
    var err = V.Name(dto.FullName, "Имя учителя") ?? V.Login(login) ?? V.Password(dto.Password) ?? V.Phone(dto.Phone, "Телефон");
    if (err != null) return Bad(err);
    if (await db.Users.AnyAsync(u => u.Login == login)) return Bad("Такой логин уже занят");
    var u = new User { FullName = V.Clean(dto.FullName), Login = login, Phone = V.NormPhone(dto.Phone), Role = Roles.Teacher, PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.Password, 11) };
    db.Users.Add(u);
    await db.SaveChangesAsync();
    return Results.Ok(new { u.Id });
});

teachers.MapPut("/{id:int}", async (int id, TeacherDto dto, AppDb db) =>
{
    var u = await db.Users.FirstOrDefaultAsync(x => x.Id == id && x.Role == Roles.Teacher);
    if (u == null) return Results.NotFound(new { error = "Учитель не найден" });
    var login = (dto.Login ?? "").Trim().ToLowerInvariant();
    var err = V.Name(dto.FullName, "Имя учителя") ?? V.Login(login) ?? V.Phone(dto.Phone, "Телефон")
        ?? (string.IsNullOrEmpty(dto.Password) ? null : V.Password(dto.Password));
    if (err != null) return Bad(err);
    if (await db.Users.AnyAsync(x => x.Login == login && x.Id != id)) return Bad("Такой логин уже занят");
    u.FullName = V.Clean(dto.FullName); u.Phone = V.NormPhone(dto.Phone);
    if (u.Login != login || !string.IsNullOrEmpty(dto.Password)) u.SecurityStamp = Guid.NewGuid().ToString("N"); // старые входы закрываются
    u.Login = login;
    if (!string.IsNullOrEmpty(dto.Password)) { u.PasswordHash = BCrypt.Net.BCrypt.HashPassword(dto.Password, 11); u.FailedLogins = 0; u.LockedUntil = null; }
    await db.SaveChangesAsync();
    return Results.Ok();
});

teachers.MapDelete("/{id:int}", async (int id, AppDb db) =>
{
    var u = await db.Users.FirstOrDefaultAsync(x => x.Id == id && x.Role == Roles.Teacher);
    if (u == null) return Results.NotFound(new { error = "Учитель не найден" });
    db.Users.Remove(u);
    await db.SaveChangesAsync();
    return Results.Ok();
});

// ================= GROUPS =================
app.MapGet("/api/groups", async (ClaimsPrincipal me, AppDb db) =>
{
    var q = db.Groups.AsQueryable();
    if (!IsAdmin(me)) { var uid = UserId(me); q = q.Where(g => g.TeacherId == uid); }
    return await q.OrderBy(g => g.Name).Select(g => new
    {
        g.Id, g.Name, g.Course, g.Schedule, g.CurrentMonth, g.StartDate, g.TeacherId,
        teacherName = g.Teacher != null ? g.Teacher.FullName : null,
        students = g.Students.Count,
    }).ToListAsync();
}).RequireAuthorization("staff");

app.MapPost("/api/groups", async (GroupDto dto, AppDb db) =>
{
    if (await ValidateGroup(dto, db, true) is { } err) return Bad(err);
    var g = new Group { Name = V.Clean(dto.Name), Course = string.IsNullOrWhiteSpace(dto.Course) ? "Fullstack + AI" : V.Clean(dto.Course), Schedule = V.CleanOpt(dto.Schedule), CurrentMonth = dto.CurrentMonth ?? 1, StartDate = UtcDate(dto.StartDate), TeacherId = dto.TeacherId };
    db.Groups.Add(g);
    await db.SaveChangesAsync();
    return Results.Ok(new { g.Id });
}).RequireAuthorization("admin");

// Админ меняет всё, учитель — только время занятий и текущий месяц своей группы
app.MapPut("/api/groups/{id:int}", async (int id, GroupDto dto, ClaimsPrincipal me, AppDb db) =>
{
    var g = await db.Groups.FindAsync(id);
    if (g == null || !CanAccess(me, g)) return Results.NotFound(new { error = "Группа не найдена" });
    var admin = IsAdmin(me);
    if (await ValidateGroup(dto, db, admin) is { } err) return Bad(err);
    g.Schedule = V.CleanOpt(dto.Schedule);
    if (dto.CurrentMonth.HasValue) g.CurrentMonth = dto.CurrentMonth.Value;
    if (admin)
    {
        g.Name = V.Clean(dto.Name);
        if (!string.IsNullOrWhiteSpace(dto.Course)) g.Course = V.Clean(dto.Course);
        g.StartDate = UtcDate(dto.StartDate);
        g.TeacherId = dto.TeacherId;
    }
    await db.SaveChangesAsync();
    return Results.Ok();
}).RequireAuthorization("staff");

app.MapDelete("/api/groups/{id:int}", async (int id, AppDb db) =>
{
    var g = await db.Groups.FindAsync(id);
    if (g == null) return Results.NotFound(new { error = "Группа не найдена" });
    var sids = await db.Students.Where(s => s.GroupId == id).Select(s => s.Id).ToListAsync();
    db.WeekScores.RemoveRange(db.WeekScores.Where(w => sids.Contains(w.StudentId)));
    db.ExtraExams.RemoveRange(db.ExtraExams.Where(w => sids.Contains(w.StudentId)));
    db.Groups.Remove(g);
    await db.SaveChangesAsync();
    return Results.Ok();
}).RequireAuthorization("admin");

// Завершить месяц: группа переходит на следующий месяц, ученики с «повтором» переводятся в другую группу
app.MapPost("/api/groups/{id:int}/finish-month", async (int id, FinishDto dto, ClaimsPrincipal me, AppDb db) =>
{
    var g = await db.Groups.FindAsync(id);
    if (g == null || !CanAccess(me, g)) return Results.NotFound(new { error = "Группа не найдена" });
    if (g.CurrentMonth >= 3) return Bad("Это последний месяц курса");
    var transfers = dto.Transfers ?? new List<TransferDto>();
    if (transfers.Count > 0 && !IsAdmin(me)) return Bad("Переводить учеников в другую группу может только суперадмин");
    var sids = await db.Students.Where(s => s.GroupId == id).Select(s => s.Id).ToListAsync();
    if (transfers.Any(t => !sids.Contains(t.StudentId))) return Bad("Ученик не из этой группы");
    Group? repeatGroup = null;
    foreach (var t in transfers)
    {
        int target;
        if (t.GroupId == null)
        {
            if (repeatGroup == null)
            {
                var baseName = g.Name.Length > 40 ? g.Name[..40] : g.Name;
                repeatGroup = new Group { Name = $"{baseName} · повтор {g.CurrentMonth}", Course = g.Course, Schedule = g.Schedule, CurrentMonth = g.CurrentMonth, TeacherId = g.TeacherId, StartDate = DateTime.UtcNow.Date };
                db.Groups.Add(repeatGroup);
                await db.SaveChangesAsync();
            }
            target = repeatGroup.Id;
        }
        else
        {
            if (t.GroupId == id || !await db.Groups.AnyAsync(x => x.Id == t.GroupId)) return Bad("Неверная группа для перевода");
            target = t.GroupId.Value;
        }
        var st = await db.Students.FindAsync(t.StudentId);
        st!.GroupId = target;
        // повтор месяца начинается с чистого журнала
        db.WeekScores.RemoveRange(db.WeekScores.Where(w => w.StudentId == t.StudentId && w.Month == g.CurrentMonth));
        db.ExtraExams.RemoveRange(db.ExtraExams.Where(w => w.StudentId == t.StudentId && w.Month == g.CurrentMonth));
    }
    g.CurrentMonth += 1;
    await db.SaveChangesAsync();
    return Results.Ok(new { currentMonth = g.CurrentMonth, repeatGroupId = repeatGroup?.Id });
}).RequireAuthorization("staff");

// ================= STUDENTS =================
app.MapGet("/api/groups/{gid:int}/students", async (int gid, ClaimsPrincipal me, AppDb db) =>
{
    var g = await db.Groups.FindAsync(gid);
    if (g == null || !CanAccess(me, g)) return Results.NotFound(new { error = "Группа не найдена" });
    var list = await db.Students.Where(s => s.GroupId == gid).OrderBy(s => s.FullName)
        .Select(s => new { s.Id, s.FullName, s.Phone, s.ParentName, s.ParentPhone, s.GroupId }).ToListAsync();
    return Results.Ok(list);
}).RequireAuthorization("staff");

app.MapPost("/api/groups/{gid:int}/students", async (int gid, StudentDto dto, ClaimsPrincipal me, AppDb db) =>
{
    var g = await db.Groups.FindAsync(gid);
    if (g == null || !CanAccess(me, g)) return Results.NotFound(new { error = "Группа не найдена" });
    if (ValidateStudent(dto) is { } err) return Bad(err);
    if (await db.Students.CountAsync(s => s.GroupId == gid) >= 60) return Bad("В группе не может быть больше 60 учеников");
    var s = new Student { GroupId = gid, FullName = V.Clean(dto.FullName), Phone = V.NormPhone(dto.Phone), ParentName = V.CleanOpt(dto.ParentName), ParentPhone = V.NormPhone(dto.ParentPhone) };
    db.Students.Add(s);
    await db.SaveChangesAsync();
    return Results.Ok(new { s.Id });
}).RequireAuthorization("staff");

app.MapPut("/api/students/{id:int}", async (int id, StudentDto dto, ClaimsPrincipal me, AppDb db) =>
{
    var s = await db.Students.Include(x => x.Group).FirstOrDefaultAsync(x => x.Id == id);
    if (s == null || !CanAccess(me, s.Group!)) return Results.NotFound(new { error = "Ученик не найден" });
    if (ValidateStudent(dto) is { } err) return Bad(err);
    s.FullName = V.Clean(dto.FullName); s.Phone = V.NormPhone(dto.Phone); s.ParentName = V.CleanOpt(dto.ParentName); s.ParentPhone = V.NormPhone(dto.ParentPhone);
    // перевод в другую группу (например, на повтор месяца) — только админ
    if (dto.GroupId.HasValue && dto.GroupId != s.GroupId && IsAdmin(me))
    {
        if (!await db.Groups.AnyAsync(g => g.Id == dto.GroupId)) return Bad("Группа не найдена");
        s.GroupId = dto.GroupId.Value;
    }
    await db.SaveChangesAsync();
    return Results.Ok();
}).RequireAuthorization("staff");

app.MapDelete("/api/students/{id:int}", async (int id, ClaimsPrincipal me, AppDb db) =>
{
    var s = await db.Students.Include(x => x.Group).FirstOrDefaultAsync(x => x.Id == id);
    if (s == null || !CanAccess(me, s.Group!)) return Results.NotFound(new { error = "Ученик не найден" });
    db.WeekScores.RemoveRange(db.WeekScores.Where(w => w.StudentId == id));
    db.ExtraExams.RemoveRange(db.ExtraExams.Where(w => w.StudentId == id));
    db.Students.Remove(s);
    await db.SaveChangesAsync();
    return Results.Ok();
}).RequireAuthorization("staff");

// Все ученики, доступные пользователю (админ — все, учитель — своих групп)
app.MapGet("/api/students", async (ClaimsPrincipal me, AppDb db) =>
{
    var q = db.Students.AsQueryable();
    if (!IsAdmin(me)) { var uid = UserId(me); q = q.Where(s => s.Group!.TeacherId == uid); }
    return await q.OrderBy(s => s.FullName).Select(s => new
    {
        s.Id, s.FullName, s.Phone, s.ParentName, s.ParentPhone, s.GroupId, s.CreatedAt,
        groupName = s.Group!.Name, course = s.Group.Course, schedule = s.Group.Schedule, currentMonth = s.Group.CurrentMonth,
    }).ToListAsync();
}).RequireAuthorization("staff");

// Обзор для суперадмина: все группы, ученики и баллы текущего месяца каждой группы
app.MapGet("/api/overview", async (AppDb db) =>
{
    var groups = await db.Groups.Select(g => new { g.Id, g.Name, g.Course, g.Schedule, g.CurrentMonth, g.TeacherId, teacherName = g.Teacher != null ? g.Teacher.FullName : null }).ToListAsync();
    var students = await db.Students.Select(s => new { s.Id, s.FullName, s.GroupId, s.Phone, s.ParentPhone }).ToListAsync();
    var monthOf = groups.ToDictionary(g => g.Id, g => g.CurrentMonth);
    var groupOf = students.ToDictionary(s => s.Id, s => s.GroupId);
    var all = await db.WeekScores.AsNoTracking().ToListAsync();
    var scores = all.Where(w => groupOf.TryGetValue(w.StudentId, out var gid) && monthOf.TryGetValue(gid, out var m) && m == w.Month).ToList();
    var teacherCount = await db.Users.CountAsync(u => u.Role == Roles.Teacher);
    return Results.Ok(new { groups, students, scores, teachers = teacherCount });
}).RequireAuthorization("admin");

// ================= BACKUP для Google Таблицы (только чтение) =================
// Включается переменной BACKUP_KEY на Render. Без неё адрес не работает (404).
// Google Apps Script присылает ключ в заголовке X-Backup-Key. Пароли и служебные поля не отдаются.
app.MapGet("/api/backup", async (HttpRequest req, AppDb db) =>
{
    var key = Environment.GetEnvironmentVariable("BACKUP_KEY");
    if (string.IsNullOrWhiteSpace(key) || key.Length < 24) return Results.NotFound();
    var sent = req.Headers["X-Backup-Key"].ToString();
    if (!System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(sent), Encoding.UTF8.GetBytes(key)))
        return Results.Unauthorized();

    var users = await db.Users.AsNoTracking().ToListAsync();
    var groups = await db.Groups.AsNoTracking().ToListAsync();
    var students = await db.Students.AsNoTracking().ToListAsync();
    var weeks = await db.WeekScores.AsNoTracking().ToListAsync();
    var extra = await db.ExtraExams.AsNoTracking().ToListAsync();
    var payments = await db.Payments.AsNoTracking().ToListAsync();
    var expenses = await db.Expenses.AsNoTracking().ToListAsync();
    var userName = users.ToDictionary(u => u.Id, u => u.FullName);
    var groupById = groups.ToDictionary(g => g.Id);
    var studentById = students.ToDictionary(s => s.Id);
    string GroupName(int? id) => id.HasValue && groupById.TryGetValue(id.Value, out var g) ? g.Name : "";
    string StudentName(int id) => studentById.TryGetValue(id, out var s) ? s.FullName : "(удалён)";
    int? StudentGroup(int id) => studentById.TryGetValue(id, out var s) ? s.GroupId : null;
    int n(int? v) => v ?? 0;

    return Results.Ok(new
    {
        createdAt = DateTime.UtcNow,
        teachers = users.Where(u => u.Role == Roles.Teacher).OrderBy(u => u.FullName)
            .Select(u => new { u.Id, u.FullName, u.Login, u.Phone, u.CreatedAt }),
        groups = groups.OrderBy(g => g.Name).Select(g => new
        {
            g.Id, g.Name, g.Course, g.Schedule, g.CurrentMonth, g.StartDate,
            teacher = g.TeacherId.HasValue && userName.TryGetValue(g.TeacherId.Value, out var t) ? t : "",
            students = students.Count(s => s.GroupId == g.Id),
        }),
        students = students.OrderBy(s => GroupName(s.GroupId)).ThenBy(s => s.FullName).Select(s => new
        {
            s.Id, s.FullName, s.Phone, s.ParentName, s.ParentPhone, group = GroupName(s.GroupId), s.GroupId, s.CreatedAt,
        }),
        scores = weeks.OrderBy(w => GroupName(StudentGroup(w.StudentId))).ThenBy(w => StudentName(w.StudentId)).ThenBy(w => w.Month).ThenBy(w => w.Week).Select(w => new
        {
            student = StudentName(w.StudentId), group = GroupName(StudentGroup(w.StudentId)), w.StudentId, w.Month, w.Week,
            w.A1, w.A2, w.A3, w.H1, w.H2, w.H3, w.Bonus, w.Exam,
            total = Math.Min(100, n(w.A1) + n(w.A2) + n(w.A3) + n(w.H1) + n(w.H2) + n(w.H3) + n(w.Bonus) + n(w.Exam)),
            w.UpdatedAt,
        }),
        extraExams = extra.Select(e => new { student = StudentName(e.StudentId), e.StudentId, e.Month, passed = e.Passed ? "Сдал" : "Не сдал", e.UpdatedAt }),
        payments = payments.OrderByDescending(p => p.PaidAt).ThenByDescending(p => p.Id).Select(p => new
        {
            p.Id, p.PaidAt, p.StudentName, p.StudentId, p.GroupName, p.Month, p.Amount,
            method = p.Method == "cash" ? "Наличные" : "Перевод", p.Note, p.CreatedAt,
        }),
        expenses = expenses.OrderByDescending(e => e.SpentAt).ThenByDescending(e => e.Id).Select(e => new
        {
            e.Id, e.SpentAt, category = ExpenseCategories.All.TryGetValue(e.Category, out var cn) ? cn : e.Category,
            e.Amount, method = e.Method == "cash" ? "Наличные" : "Перевод", teacher = e.TeacherName, e.Note, e.CreatedAt,
        }),
    });
});

// ================= FINANCE (только суперадмин) =================
var fin = app.MapGroup("/api/finance").RequireAuthorization("admin");

// Цена одного месяца курса (сомони)
fin.MapGet("/settings", async (AppDb db) =>
{
    var p = await db.Settings.FindAsync("monthPrice");
    return Results.Ok(new { monthPrice = decimal.TryParse(p?.Value, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : 0m });
});
fin.MapPut("/settings", async (FinanceSettingsDto dto, AppDb db) =>
{
    if (dto.MonthPrice is < 0 or > 1_000_000) return Bad("Цена: от 0 до 1 000 000 сомони");
    var p = await db.Settings.FindAsync("monthPrice");
    var val = dto.MonthPrice.ToString(System.Globalization.CultureInfo.InvariantCulture);
    if (p == null) db.Settings.Add(new AppSetting { Key = "monthPrice", Value = val }); else p.Value = val;
    await db.SaveChangesAsync();
    return Results.Ok();
});

// Все оплаты (новые сверху)
fin.MapGet("/payments", async (AppDb db) =>
{
    var list = await db.Payments.AsNoTracking().ToListAsync();
    return Results.Ok(list.OrderByDescending(p => p.PaidAt).ThenByDescending(p => p.Id));
});

fin.MapPost("/payments", async (PaymentDto dto, ClaimsPrincipal me, AppDb db) =>
{
    var s = await db.Students.Include(x => x.Group).FirstOrDefaultAsync(x => x.Id == dto.StudentId);
    if (s == null) return Bad("Ученик не найден");
    if (ValidatePayment(dto) is { } err) return Bad(err);
    var p = new Payment
    {
        StudentId = s.Id, StudentName = s.FullName, GroupId = s.GroupId, GroupName = s.Group?.Name ?? "",
        Month = dto.Month, Amount = Math.Round(dto.Amount, 2), Method = dto.Method!, PaidAt = UtcDate(dto.PaidAt) ?? DateTime.UtcNow.Date,
        Note = V.CleanOpt(dto.Note), CreatedById = UserId(me),
    };
    db.Payments.Add(p);
    await db.SaveChangesAsync();
    return Results.Ok(p);
});

fin.MapPut("/payments/{id:int}", async (int id, PaymentDto dto, AppDb db) =>
{
    var p = await db.Payments.FindAsync(id);
    if (p == null) return Results.NotFound(new { error = "Оплата не найдена" });
    if (ValidatePayment(dto) is { } err) return Bad(err);
    p.Month = dto.Month; p.Amount = Math.Round(dto.Amount, 2); p.Method = dto.Method!;
    p.PaidAt = UtcDate(dto.PaidAt) ?? p.PaidAt; p.Note = V.CleanOpt(dto.Note);
    await db.SaveChangesAsync();
    return Results.Ok(p);
});

fin.MapDelete("/payments/{id:int}", async (int id, AppDb db) =>
{
    var p = await db.Payments.FindAsync(id);
    if (p == null) return Results.NotFound(new { error = "Оплата не найдена" });
    db.Payments.Remove(p);
    await db.SaveChangesAsync();
    return Results.Ok();
});

// ---------- Расходы (только суперадмин) ----------
fin.MapGet("/expenses", async (AppDb db) =>
{
    var list = await db.Expenses.AsNoTracking().ToListAsync();
    return Results.Ok(list.OrderByDescending(e => e.SpentAt).ThenByDescending(e => e.Id));
});

fin.MapPost("/expenses", async (ExpenseDto dto, ClaimsPrincipal me, AppDb db) =>
{
    if (ValidateExpense(dto) is { } err) return Bad(err);
    var (tid, tname, terr) = await ExpenseTeacher(dto, db);
    if (terr != null) return Bad(terr);
    var e = new Expense
    {
        Category = dto.Category!, Amount = Math.Round(dto.Amount, 2), Method = dto.Method!, SpentAt = UtcDate(dto.SpentAt) ?? DateTime.UtcNow.Date,
        TeacherId = tid, TeacherName = tname, Note = V.CleanOpt(dto.Note), CreatedById = UserId(me),
    };
    db.Expenses.Add(e);
    await db.SaveChangesAsync();
    return Results.Ok(e);
});

fin.MapPut("/expenses/{id:int}", async (int id, ExpenseDto dto, AppDb db) =>
{
    var e = await db.Expenses.FindAsync(id);
    if (e == null) return Results.NotFound(new { error = "Расход не найден" });
    if (ValidateExpense(dto) is { } err) return Bad(err);
    var (tid, tname, terr) = await ExpenseTeacher(dto, db);
    if (terr != null) return Bad(terr);
    e.Category = dto.Category!; e.Amount = Math.Round(dto.Amount, 2); e.Method = dto.Method!;
    e.SpentAt = UtcDate(dto.SpentAt) ?? e.SpentAt; e.TeacherId = tid; e.TeacherName = tname; e.Note = V.CleanOpt(dto.Note);
    await db.SaveChangesAsync();
    return Results.Ok(e);
});

fin.MapDelete("/expenses/{id:int}", async (int id, AppDb db) =>
{
    var e = await db.Expenses.FindAsync(id);
    if (e == null) return Results.NotFound(new { error = "Расход не найден" });
    db.Expenses.Remove(e);
    await db.SaveChangesAsync();
    return Results.Ok();
});

// ================= SCORES =================
app.MapGet("/api/groups/{gid:int}/scores", async (int gid, int month, ClaimsPrincipal me, AppDb db) =>
{
    if (month is < 1 or > 3) return Bad("Месяц должен быть от 1 до 3");
    var g = await db.Groups.FindAsync(gid);
    if (g == null || !CanAccess(me, g)) return Results.NotFound(new { error = "Группа не найдена" });
    var sids = await db.Students.Where(s => s.GroupId == gid).Select(s => s.Id).ToListAsync();
    var weeks = await db.WeekScores.Where(w => sids.Contains(w.StudentId) && w.Month == month).ToListAsync();
    var extra = await db.ExtraExams.Where(w => sids.Contains(w.StudentId) && w.Month == month).ToListAsync();
    return Results.Ok(new { weeks, extra });
}).RequireAuthorization("staff");

app.MapPut("/api/scores", async (ScoreDto dto, ClaimsPrincipal me, AppDb db) =>
{
    var s = await db.Students.Include(x => x.Group).FirstOrDefaultAsync(x => x.Id == dto.StudentId);
    if (s == null || !CanAccess(me, s.Group!)) return Results.NotFound(new { error = "Ученик не найден" });
    if (dto.Month is < 1 or > 3 || dto.Week is < 1 or > 4) return Bad("Неверный месяц или неделя");
    var err = V.Range(dto.A1, 2, "Посещение") ?? V.Range(dto.A2, 2, "Посещение") ?? V.Range(dto.A3, 2, "Посещение")
        ?? V.Range(dto.H1, 10, "ДЗ") ?? V.Range(dto.H2, 10, "ДЗ") ?? V.Range(dto.H3, 10, "ДЗ")
        ?? V.Range(dto.Bonus, 14, "Бонус") ?? V.Range(dto.Exam, 50, "Экзамен");
    if (err != null) return Bad(err);
    var w = await db.WeekScores.FirstOrDefaultAsync(x => x.StudentId == dto.StudentId && x.Month == dto.Month && x.Week == dto.Week);
    if (w == null) { w = new WeekScore { StudentId = dto.StudentId, Month = dto.Month, Week = dto.Week }; db.WeekScores.Add(w); }
    var now = DateTime.UtcNow;
    if (dto.A1 != w.A1) w.D1 = dto.A1.HasValue ? now : null;
    if (dto.A2 != w.A2) w.D2 = dto.A2.HasValue ? now : null;
    if (dto.A3 != w.A3) w.D3 = dto.A3.HasValue ? now : null;
    w.A1 = dto.A1; w.A2 = dto.A2; w.A3 = dto.A3;
    w.H1 = dto.H1; w.H2 = dto.H2; w.H3 = dto.H3;
    w.Bonus = dto.Bonus; w.Exam = dto.Exam;
    w.UpdatedAt = now;
    await db.SaveChangesAsync();
    return Results.Ok(w);
}).RequireAuthorization("staff");

app.MapPut("/api/extra-exam", async (ExtraDto dto, ClaimsPrincipal me, AppDb db) =>
{
    if (dto.Month is < 1 or > 3) return Bad("Месяц должен быть от 1 до 3");
    var s = await db.Students.Include(x => x.Group).FirstOrDefaultAsync(x => x.Id == dto.StudentId);
    if (s == null || !CanAccess(me, s.Group!)) return Results.NotFound(new { error = "Ученик не найден" });
    var e = await db.ExtraExams.FirstOrDefaultAsync(x => x.StudentId == dto.StudentId && x.Month == dto.Month);
    if (dto.Passed == null) { if (e != null) db.ExtraExams.Remove(e); }
    else
    {
        if (e == null) { e = new ExtraExam { StudentId = dto.StudentId, Month = dto.Month }; db.ExtraExams.Add(e); }
        e.Passed = dto.Passed.Value; e.UpdatedAt = DateTime.UtcNow;
    }
    await db.SaveChangesAsync();
    return Results.Ok();
}).RequireAuthorization("staff");

app.Run();

// ---------- helpers ----------
static IResult Bad(string error) => Results.BadRequest(new { error });
static string? ValidateExpense(ExpenseDto dto)
{
    if (string.IsNullOrEmpty(dto.Category) || !ExpenseCategories.All.ContainsKey(dto.Category)) return "Выберите категорию расхода";
    if (dto.Amount <= 0 || dto.Amount > 10_000_000) return "Сумма: больше 0 и не больше 10 000 000";
    if (dto.Method is not ("cash" or "transfer")) return "Способ оплаты: наличные или перевод";
    if (dto.SpentAt.HasValue && (dto.SpentAt.Value.Year < 2020 || dto.SpentAt.Value.Year > 2100)) return "Неверная дата расхода";
    if (dto.Category == "other" && string.IsNullOrWhiteSpace(dto.Note)) return "Для категории «Другие» напишите комментарий";
    return V.Opt(dto.Note, 300, "Комментарий");
}
static async Task<(int?, string, string?)> ExpenseTeacher(ExpenseDto dto, AppDb db)
{
    if (!dto.TeacherId.HasValue || dto.Category is not ("salary" or "teacher_bonus")) return (null, "", null);
    var t = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == dto.TeacherId && u.Role == Roles.Teacher);
    if (t == null) return (null, "", "Учитель не найден");
    return (t.Id, t.FullName, null);
}
static string? ValidatePayment(PaymentDto dto)
{
    if (dto.Month is < 1 or > 3) return "Месяц курса: от 1 до 3";
    if (dto.Amount <= 0 || dto.Amount > 1_000_000) return "Сумма: больше 0 и не больше 1 000 000";
    if (dto.Method is not ("cash" or "transfer")) return "Способ оплаты: наличные или перевод";
    if (dto.PaidAt.HasValue && (dto.PaidAt.Value.Year < 2020 || dto.PaidAt.Value.Year > 2100)) return "Неверная дата оплаты";
    return V.Opt(dto.Note, 200, "Комментарий");
}
// PostgreSQL (timestamptz) принимает только даты с Kind=Utc; дата из формы приходит без часового пояса
static DateTime? UtcDate(DateTime? d) => d.HasValue ? DateTime.SpecifyKind(d.Value.Date, DateTimeKind.Utc) : null;
static int UserId(ClaimsPrincipal p) => int.TryParse(p.FindFirst("sub")?.Value, out var id) ? id : 0;
static bool IsAdmin(ClaimsPrincipal p) => p.IsInRole(Roles.Admin);
static bool CanAccess(ClaimsPrincipal p, Group g) => IsAdmin(p) || g.TeacherId == UserId(p);

static async Task<string?> ValidateGroup(GroupDto dto, AppDb db, bool admin)
{
    if (admin)
    {
        var e = V.Name(dto.Name, "Название группы", 2, 60) ?? V.Opt(dto.Course, 60, "Курс");
        if (e != null) return e;
        if (dto.TeacherId.HasValue && !await db.Users.AnyAsync(u => u.Id == dto.TeacherId && u.Role == Roles.Teacher)) return "Учитель не найден";
        if (dto.StartDate.HasValue && (dto.StartDate.Value.Year < 2020 || dto.StartDate.Value.Year > 2100)) return "Неверная дата старта";
    }
    if (dto.CurrentMonth is < 1 or > 3) return "Месяц должен быть от 1 до 3";
    return V.Opt(dto.Schedule, 100, "Время занятий");
}
static string? ValidateStudent(StudentDto dto) =>
    V.Name(dto.FullName, "Имя ученика") ?? V.Phone(dto.Phone, "Телефон ученика") ?? V.Opt(dto.ParentName, 100, "Имя родителя")
    ?? (string.IsNullOrWhiteSpace(dto.ParentName) ? null : V.Name(dto.ParentName, "Имя родителя")) ?? V.Phone(dto.ParentPhone, "WhatsApp родителя");

static string PgConn(string url)
{
    if (!url.StartsWith("postgres")) return url; // уже строка подключения Npgsql
    var uri = new Uri(url);
    var userInfo = uri.UserInfo.Split(':', 2);
    var dbPort = uri.Port > 0 ? uri.Port : 5432;
    return $"Host={uri.Host};Port={dbPort};Database={uri.AbsolutePath.TrimStart('/')};Username={Uri.UnescapeDataString(userInfo[0])};Password={Uri.UnescapeDataString(userInfo.Length > 1 ? userInfo[1] : "")};SSL Mode=Prefer";
}

// ---------- DTO ----------
record LoginDto(string? Login, string? Password);
record PasswordDto(string? OldPassword, string? NewPassword);
record ProfileDto(string? FullName, string? Login, string? CurrentPassword);
record TeacherDto(string? FullName, string? Login, string? Password, string? Phone);
record GroupDto(string? Name, string? Course, string? Schedule, int? CurrentMonth, DateTime? StartDate, int? TeacherId);
record StudentDto(string? FullName, string? Phone, string? ParentName, string? ParentPhone, int? GroupId);
record ScoreDto(int StudentId, int Month, int Week, int? A1, int? A2, int? A3, int? H1, int? H2, int? H3, int? Bonus, int? Exam);
record ExtraDto(int StudentId, int Month, bool? Passed);
record PaymentDto(int StudentId, int Month, decimal Amount, string? Method, DateTime? PaidAt, string? Note);
record FinanceSettingsDto(decimal MonthPrice);
record ExpenseDto(string? Category, decimal Amount, string? Method, DateTime? SpentAt, int? TeacherId, string? Note);

static class ExpenseCategories
{
    public static readonly Dictionary<string, string> All = new()
    {
        ["rent"] = "Ичора",
        ["teacher_bonus"] = "Бонуси муаллим",
        ["marketing"] = "Маркетинг",
        ["salary"] = "Маош",
        ["internet"] = "Интернет",
        ["tax"] = "Налог",
        ["documents"] = "Расходы на документы",
        ["state_registration"] = "Оплата государственной регистрации",
        ["legal"] = "Юридические расходы",
        ["annual_state"] = "Годовые гос. расходы",
        ["household"] = "Бытовые расходы",
        ["other"] = "Другие",
    };
}
record TransferDto(int StudentId, int? GroupId);
record FinishDto(List<TransferDto>? Transfers);
