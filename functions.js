export function extractKeywordAndTime(message, keyword) {
    // Regex for "X h Y m" format (hours and minutes)
    const timeRegexHoursMinutes = /(\d+)\s*h\s*(\d{2})/;
    // Regex for "X m Y s" format (minutes and seconds)
    const timeRegexMinutesSeconds = /(\d+)\s*m\s*(\d{2})/;
    // Regex for "X h" format (only hours)
    const timeRegexOnlyHours = /(\d+)\s*h/;
    // Regex for "X m" format (only minutes)
    const timeRegexOnlyMinutes = /(\d+)\s*m/;
    
    const timeMatchHoursMinutes = message.match(timeRegexHoursMinutes);
    const timeMatchMinutesSeconds = message.match(timeRegexMinutesSeconds);
    const timeMatchOnlyHours = message.match(timeRegexOnlyHours);
    const timeMatchOnlyMinutes = message.match(timeRegexOnlyMinutes);

    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    let totalSeconds = 0;
    const unixTimeNow = Math.floor(Date.now() / 1000);
    let unixTimeContent = unixTimeNow; // Default to current time if no match

    if (timeMatchHoursMinutes) {
        // If we matched "X h Y m" format
        hours = parseInt(timeMatchHoursMinutes[1], 10);
        minutes = parseInt(timeMatchHoursMinutes[2], 10);
        totalSeconds = (hours * 3600) + (minutes * 60); // Convert to seconds
        unixTimeContent = unixTimeNow + totalSeconds;
    } else if (timeMatchMinutesSeconds) {
        // If we matched "X m Y s" format
        minutes = parseInt(timeMatchMinutesSeconds[1], 10);
        seconds = parseInt(timeMatchMinutesSeconds[2], 10);
        totalSeconds = (minutes * 60) + seconds; // Convert to seconds
        unixTimeContent = unixTimeNow + totalSeconds;
    } else if (timeMatchOnlyHours) {
        // If we matched only "X h" format
        hours = parseInt(timeMatchOnlyHours[1], 10);
        totalSeconds = hours * 3600; // Convert to seconds
        unixTimeContent = unixTimeNow + totalSeconds;
    } else if (timeMatchOnlyMinutes) {
        // If we matched only "X m" format
        minutes = parseInt(timeMatchOnlyMinutes[1], 10);
        totalSeconds = minutes * 60; // Convert to seconds
        unixTimeContent = unixTimeNow + totalSeconds;
    }

    // Return the calculated Unix timestamp
    return unixTimeContent;
}