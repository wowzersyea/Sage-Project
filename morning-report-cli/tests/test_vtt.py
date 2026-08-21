from morningreport import vtt


def test_parses_zoom_shape(load_tx):
    tx = load_tx("clean.vtt")
    assert len(tx) == 19
    assert tx.cues[0].speaker == "D Chief"
    assert tx.cues[0].start == 4.0
    assert "objective" in tx.cues[0].text


def test_timestamps():
    assert vtt.parse_timestamp("00:07:12.480") == 432.48
    assert vtt.parse_timestamp("00:00:04,120") == 4.12
    assert vtt.parse_timestamp("07:12.000") == 432.0
    assert vtt.format_timestamp(432.48) == "07:12"
    assert vtt.format_timestamp(0) == "00:00"


def test_duration_and_windows(load_tx):
    tx = load_tx("clean.vtt")
    assert 1450 < tx.duration < 1500          # inside 25 minutes
    first_pass = tx.between(7 * 60, 11 * 60)
    assert len(first_pass) >= 2
    assert all(c.end > 420 and c.start < 660 for c in first_pass)


def test_speaker_split_is_not_fooled_by_colons():
    tx = vtt.parse("""WEBVTT

1
00:00:01.000 --> 00:00:03.000
Will Barlow: the ratio was 3:1 today

2
00:00:04.000 --> 00:00:06.000
38.6: this is not a speaker
""")
    assert tx.cues[0].speaker == "Will Barlow"
    assert "3:1" in tx.cues[0].text
    assert tx.cues[1].speaker is None


def test_tolerates_junk_and_notes():
    tx = vtt.parse("""WEBVTT
NOTE this is a note

cue-identifier-not-a-number
00:00:01.000 --> 00:00:03.000
A Resident: hello


""")
    assert len(tx) == 1
    assert tx.cues[0].speaker == "A Resident"


def test_empty_transcript_is_not_a_crash():
    tx = vtt.parse("WEBVTT\n\n")
    assert len(tx) == 0
    assert tx.duration == 0
    assert tx.speakers == []
