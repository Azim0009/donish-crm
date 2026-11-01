using Microsoft.EntityFrameworkCore;

namespace DonishCrm;

public static class Roles
{
    public const string Admin = "admin";
    public const string Teacher = "teacher";
}

public class User
{
    public int Id { get; set; }
    public string FullName { get; set; } = "";
    public string Login { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Role { get; set; } = Roles.Teacher;
    public string? Phone { get; set; }
    public int FailedLogins { get; set; }          // неудачные попытки подряд
    public DateTime? LockedUntil { get; set; }      // блокировка после 5 ошибок
    public string SecurityStamp { get; set; } = Guid.NewGuid().ToString("N"); // меняется при смене пароля → старые входы закрываются
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Group
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Course { get; set; } = "Fullstack + AI";
    public string? Schedule { get; set; }      // например: "Пн, Ср, Пт · 14:00–16:00"
    public int CurrentMonth { get; set; } = 1; // 1..3
    public DateTime? StartDate { get; set; }
    public int? TeacherId { get; set; }
    public User? Teacher { get; set; }
    public List<Student> Students { get; set; } = new();
}

public class Student
{
    public int Id { get; set; }
    public int GroupId { get; set; }
    public Group? Group { get; set; }
    public string FullName { get; set; } = "";
    public string? Phone { get; set; }
    public string? ParentName { get; set; }
    public string? ParentPhone { get; set; }   // WhatsApp родителей
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

// Баллы ученика за одну неделю (3 урока). Максимум 100.
public class WeekScore
{
    public int Id { get; set; }
    public int StudentId { get; set; }
    public int Month { get; set; }   // 1..3
    public int Week { get; set; }    // 1..4
    public int? A1 { get; set; }     // посещение урока 1: 2 пришёл, 1 опоздал, 0 нет
    public int? A2 { get; set; }
    public int? A3 { get; set; }
    public int? H1 { get; set; }     // ДЗ 0..10
    public int? H2 { get; set; }
    public int? H3 { get; set; }
    public int? Bonus { get; set; }  // 0..14
    public int? Exam { get; set; }   // 0..50
    public DateTime? D1 { get; set; } // когда отмечено посещение урока 1 (UTC)
    public DateTime? D2 { get; set; }
    public DateTime? D3 { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

// Дополнительный экзамен для тех, у кого 75–79 за месяц
public class ExtraExam
{
    public int Id { get; set; }
    public int StudentId { get; set; }
    public int Month { get; set; }
    public bool Passed { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

public class AppDb : DbContext
{
    public AppDb(DbContextOptions<AppDb> o) : base(o) { }
    public DbSet<User> Users => Set<User>();
    public DbSet<Group> Groups => Set<Group>();
    public DbSet<Student> Students => Set<Student>();
    public DbSet<WeekScore> WeekScores => Set<WeekScore>();
    public DbSet<ExtraExam> ExtraExams => Set<ExtraExam>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>().HasIndex(x => x.Login).IsUnique();
        b.Entity<User>().Property(x => x.Login).HasMaxLength(32);
        b.Entity<User>().Property(x => x.FullName).HasMaxLength(100);
        b.Entity<User>().Property(x => x.SecurityStamp).HasMaxLength(64);
        b.Entity<Group>().Property(x => x.Name).HasMaxLength(60);
        b.Entity<Group>().Property(x => x.Course).HasMaxLength(60);
        b.Entity<Group>().Property(x => x.Schedule).HasMaxLength(100);
        b.Entity<Student>().Property(x => x.FullName).HasMaxLength(100);
        b.Entity<Student>().Property(x => x.ParentName).HasMaxLength(100);
        b.Entity<Student>().Property(x => x.Phone).HasMaxLength(20);
        b.Entity<Student>().Property(x => x.ParentPhone).HasMaxLength(20);
        b.Entity<WeekScore>().HasIndex(x => new { x.StudentId, x.Month, x.Week }).IsUnique();
        b.Entity<ExtraExam>().HasIndex(x => new { x.StudentId, x.Month }).IsUnique();
        b.Entity<Group>().HasOne(g => g.Teacher).WithMany().HasForeignKey(g => g.TeacherId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<Student>().HasOne(s => s.Group).WithMany(g => g.Students).HasForeignKey(s => s.GroupId).OnDelete(DeleteBehavior.Cascade);
    }
}
