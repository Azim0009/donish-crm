using System.Text.RegularExpressions;

namespace DonishCrm;

// Проверка и очистка входных данных
public static partial class V
{
    [GeneratedRegex(@"\s+")] private static partial Regex Spaces();
    [GeneratedRegex(@"^[\p{L}\s\-'’.]+$")] private static partial Regex PersonName();
    [GeneratedRegex(@"^[\p{L}\p{N}\s\-'’.,()+:/№·&_]+$")] private static partial Regex TitleText();
    [GeneratedRegex(@"^[a-z0-9._-]{3,32}$")] private static partial Regex LoginRx();
    [GeneratedRegex(@"^[0-9+\-\s()]+$")] private static partial Regex PhoneChars();
    [GeneratedRegex(@"[<>{}\\`$]")] private static partial Regex Dangerous();

    public static string Clean(string? s) => Spaces().Replace(s ?? "", " ").Trim();
    public static string? CleanOpt(string? s) { var c = Clean(s); return c.Length == 0 ? null : c; }

    // Имя человека: только буквы, пробел, дефис, апостроф, точка
    public static string? Name(string? s, string label, int min = 2, int max = 100)
    {
        var c = Clean(s);
        if (c.Length == 0) return $"{label}: заполните поле";
        if (c.Length < min || c.Length > max) return $"{label}: от {min} до {max} символов";
        var person = !label.StartsWith("Название");
        if (person ? !PersonName().IsMatch(c) : !TitleText().IsMatch(c)) return person ? $"{label}: только буквы" : $"{label}: недопустимые символы";
        return null;
    }

    public static string? Opt(string? s, int max, string label)
    {
        var c = Clean(s);
        if (c.Length > max) return $"{label}: не больше {max} символов";
        if (Dangerous().IsMatch(c)) return $"{label}: недопустимые символы";
        return null;
    }

    public static string? Login(string login) =>
        LoginRx().IsMatch(login) ? null : "Логин: 3–32 символа, латинские буквы, цифры, точка, _ или -";

    public static string? Password(string? p)
    {
        if (string.IsNullOrEmpty(p) || p.Length < 8 || p.Length > 128) return "Пароль: от 8 до 128 символов";
        if (!p.Any(char.IsLetter) || !p.Any(char.IsDigit)) return "Пароль должен содержать буквы и цифры";
        return null;
    }

    public static string? Phone(string? s, string label)
    {
        var c = Clean(s);
        if (c.Length == 0) return null;
        if (!PhoneChars().IsMatch(c)) return $"{label}: только цифры, например +992 90 123 45 67";
        var d = new string(c.Where(char.IsDigit).ToArray());
        if (d.Length < 9 || d.Length > 15) return $"{label}: от 9 до 15 цифр";
        return null;
    }

    // 9 цифр → номер Таджикистана (+992)
    public static string? NormPhone(string? s)
    {
        var d = new string((s ?? "").Where(char.IsDigit).ToArray());
        if (d.Length == 0) return null;
        return "+" + (d.Length == 9 ? "992" + d : d);
    }

    public static string? Range(int? v, int max, string label) =>
        v is null || (v >= 0 && v <= max) ? null : $"{label}: от 0 до {max}";
}
