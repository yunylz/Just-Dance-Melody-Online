const screenConfig = {
    bannedMaps: ["MJEarthSong", "Conversation", "BB", "IAmTheBestALT"],
    screenDurations: {
        "tournament-presentation": 15,
        "tournament-lobby": 15,
        "tournament-recap": 30,
        vote: {
            waitBeforeVoteCompute: 5,
            voteDuration: 17,
            totalDuration: 47
        },
        "vote-lobby": 12,
        "vote-recap": 20,
        "in-game": "dynamic",
        "waiting-screen": 20
    },
    vote: {
        probability: 80,
        votePlaylist: {
            classicVote: {
                probability: 30,
                playlistSize: 2,
                mapNameRules: {
                    isPreselectedMaps: false,
                    preselectedMapNames: [],
                    isRandomMaps: true,
                    isJDVersionMap: false,
                    JDVersionMaps: [],
                    isDifficultyOnly: false,
                    difficultyOnly: [],
                    containsSpecificArtist: false,
                    specificArtist: "",
                    isOnlyCoachCount: false,
                    coachCountOnly: [],
                    excludeBannedMaps: false
                }
            },
            jdnextVote: {
                probability: 30,
                playlistSize: 2,
                mapNameRules: {
                    isPreselectedMaps: false,
                    preselectedMapNames: [],
                    isRandomMaps: false,
                    isJDVersionMap: true,
                    JDVersionMaps: [2023, 2024, 2025],
                    isDifficultyOnly: false,
                    difficultyOnly: [],
                    containsSpecificArtist: false,
                    specificArtist: "",
                    isOnlyCoachCount: false,
                    coachCountOnly: [],
                    excludeBannedMaps: false
                }
            },
            jdasiaVote: {
                probability: 20,
                playlistSize: 2,
                mapNameRules: {
                    isPreselectedMaps: false,
                    preselectedMapNames: [],
                    isRandomMaps: false,
                    isJDVersionMap: true,
                    JDVersionMaps: [1104, 1103, 1102, 1101, 1100, 1003, 1001, 1000, 3001],
                    isDifficultyOnly: false,
                    difficultyOnly: [],
                    containsSpecificArtist: false,
                    specificArtist: "",
                    isOnlyCoachCount: false,
                    coachCountOnly: [],
                    excludeBannedMaps: false
                }
            },
            legacyVote: {
                probability: 10,
                playlistSize: 2,
                mapNameRules: {
                    isPreselectedMaps: false,
                    preselectedMapNames: [],
                    isRandomMaps: false,
                    isJDVersionMap: true,
                    JDVersionMaps: [1, 2, 3, 4, 2014],
                    isDifficultyOnly: false,
                    difficultyOnly: [],
                    containsSpecificArtist: false,
                    specificArtist: "",
                    isOnlyCoachCount: false,
                    coachCountOnly: [],
                    excludeBannedMaps: false
                }
            },
            extremeVote: {
                probability: 5,
                playlistSize: 2,
                mapNameRules: {
                    isPreselectedMaps: false,
                    preselectedMapNames: [],
                    isRandomMaps: false,
                    isJDVersionMap: false,
                    JDVersionMaps: [],
                    isDifficultyOnly: true,
                    difficultyOnly: [4],
                    containsSpecificArtist: false,
                    specificArtist: "",
                    isOnlyCoachCount: false,
                    coachCountOnly: [],
                    excludeBannedMaps: false
                }
            },
            ariVote: {
                probability: 5,
                playlistSize: 2,
                mapNameRules: {
                    isPreselectedMaps: false,
                    preselectedMapNames: [],
                    isRandomMaps: false,
                    isJDVersionMap: false,
                    JDVersionMaps: [],
                    isDifficultyOnly: false,
                    difficultyOnly: [],
                    containsSpecificArtist: true,
                    specificArtist: "Ariana Grande",
                    isOnlyCoachCount: false,
                    coachCountOnly: [],
                    excludeBannedMaps: false
                }
            },
        }
    },
    tournament: {
        probability: 20,
        tournamentPlaylist: {
            classicTournament: {
                probability: 50,
                playlistSize: 3,
                tournamentLogo: "https://jdmo-cdn.c0llydoll.com/public/wdf/tournament/classicTournament/JDMO_Regular_2026_tournament_cup.png",
                tournamentType: "default",
                rewards: [{
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "mojo",
                        value: 700
                    }
                ],
                mapNameRules: {
                    isPreselectedMaps: false,
                    preselectedMapNames: [],
                    isRandomMaps: true,
                    isJDVersionMap: false,
                    JDVersionMaps: [],
                    isDifficultyOnly: false,
                    difficultyOnly: [],
                    containsSpecificArtist: false,
                    specificArtist: "",
                    isOnlyCoachCount: false,
                    coachCountOnly: [],
                    excludeBannedMaps: true
                }
            },
            extremeTournament: {
                probability: 2,
                playlistSize: 2,
                tournamentLogo: "https://jdmo-cdn.c0llydoll.com/public/wdf/tournament/extremeTournament/1b5f7020614ad6a68b4579b22b947961.png",
                tournamentType: "default",
                rewards: [{
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "mojo",
                        value: 700
                    }
                ],
                mapNameRules: {
                    isPreselectedMaps: false,
                    preselectedMapNames: [],
                    isRandomMaps: false,
                    isJDVersionMap: false,
                    JDVersionMaps: [],
                    isDifficultyOnly: true,
                    difficultyOnly: [4],
                    containsSpecificArtist: false,
                    specificArtist: "",
                    isOnlyCoachCount: false,
                    coachCountOnly: [],
                    excludeBannedMaps: false
                }
            },
            jd2019Tournament: {
                probability: 8,
                playlistSize: 3,
                tournamentLogo: "https://jdmo-cdn.c0llydoll.com/public/wdf/tournament/SagaTournament/8b17610deb8d9b451bac8e7445633c79.png",
                tournamentType: "default",
                rewards: [{
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "mojo",
                        value: 700
                    }
                ],
                mapNameRules: {
                    isPreselectedMaps: false,
                    preselectedMapNames: [],
                    isRandomMaps: false,
                    isJDVersionMap: true,
                    JDVersionMaps: [2019],
                    isDifficultyOnly: false,
                    difficultyOnly: [],
                    containsSpecificArtist: false,
                    specificArtist: "",
                    isOnlyCoachCount: false,
                    coachCountOnly: [],
                    excludeBannedMaps: false
                }
            },
            jd2018Tournament: {
                probability: 8,
                playlistSize: 3,
                tournamentLogo: "https://jdmo-cdn.c0llydoll.com/public/wdf/tournament/SagaTournament/351a403ab155d456ae4aec21e0ba65a3.png",
                tournamentType: "default",
                rewards: [{
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "mojo",
                        value: 700
                    }
                ],
                mapNameRules: {
                    isPreselectedMaps: false,
                    preselectedMapNames: [],
                    isRandomMaps: false,
                    isJDVersionMap: true,
                    JDVersionMaps: [2018],
                    isDifficultyOnly: false,
                    difficultyOnly: [],
                    containsSpecificArtist: false,
                    specificArtist: "",
                    isOnlyCoachCount: false,
                    coachCountOnly: [],
                    excludeBannedMaps: false
                }
            },
            jd2020Tournament: {
                probability: 8,
                playlistSize: 3,
                tournamentLogo: "https://jdmo-cdn.c0llydoll.com/public/wdf/tournament/SagaTournament/3a9330aa2b1a5b2a724e9aba9c089500.png",
                tournamentType: "default",
                rewards: [{
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "mojo",
                        value: 700
                    }
                ],
                mapNameRules: {
                    isPreselectedMaps: false,
                    preselectedMapNames: [],
                    isRandomMaps: false,
                    isJDVersionMap: true,
                    JDVersionMaps: [2020],
                    isDifficultyOnly: false,
                    difficultyOnly: [],
                    containsSpecificArtist: false,
                    specificArtist: "",
                    isOnlyCoachCount: false,
                    coachCountOnly: [],
                    excludeBannedMaps: true
                }
            },
            jd2021Tournament: {
                probability: 8,
                playlistSize: 3,
                tournamentLogo: "https://jdmo-cdn.c0llydoll.com/public/wdf/tournament/SagaTournament/d5ef801a74a60821fab3849ec2356bd2.png",
                tournamentType: "default",
                rewards: [{
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "mojo",
                        value: 700
                    }
                ],
                mapNameRules: {
                    isPreselectedMaps: false,
                    preselectedMapNames: [],
                    isRandomMaps: false,
                    isJDVersionMap: true,
                    JDVersionMaps: [2021],
                    isDifficultyOnly: false,
                    difficultyOnly: [],
                    containsSpecificArtist: false,
                    specificArtist: "",
                    isOnlyCoachCount: false,
                    coachCountOnly: [],
                    excludeBannedMaps: true

                }
            },
            jd2022Tournament: {
                probability: 8,
                playlistSize: 3,
                tournamentLogo: "https://jdmo-cdn.c0llydoll.com/public/wdf/tournament/SagaTournament/4f755b8735684dcbd41d21941881916f.png",
                tournamentType: "default",
                rewards: [{
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "mojo",
                        value: 700
                    }
                ],
                mapNameRules: {
                    isPreselectedMaps: false,
                    preselectedMapNames: [],
                    isRandomMaps: false,
                    isJDVersionMap: true,
                    JDVersionMaps: [2022],
                    isDifficultyOnly: false,
                    difficultyOnly: [],
                    containsSpecificArtist: false,
                    specificArtist: "",
                    isOnlyCoachCount: false,
                    coachCountOnly: [],
                    excludeBannedMaps: true
                }
            },
            jd2026Tournament: {
                probability: 8,
                playlistSize: 3,
                tournamentLogo: "https://jdmo-cdn.c0llydoll.com/public/wdf/tournament/SagaTournament/JDMO_2026_tournament_cup.png",
                tournamentType: "default",
                rewards: [{
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "mojo",
                        value: 700
                    }
                ],
                mapNameRules: {
                    isPreselectedMaps: false,
                    preselectedMapNames: [],
                    isRandomMaps: false,
                    isJDVersionMap: true,
                    JDVersionMaps: [2026],
                    isDifficultyOnly: false,
                    difficultyOnly: [],
                    containsSpecificArtist: false,
                    specificArtist: "",
                    isOnlyCoachCount: false,
                    coachCountOnly: [],
                    excludeBannedMaps: true
                }
            },
            weeklyTournament: {
                probability: 0,
                playlistSize: 8,
                tournamentLogo: "https://jdmo-cdn.c0llydoll.com/public/wdf/tournament/weeklyTournament/JDMO_Weekly_2026_tournament_cup.png",
                tournamentType: "default",
                rewards: [{
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "skin"
                    },
                    {
                        type: "mojo",
                        value: 700
                    }
                ],
                mapNameRules: {
                    isPreselectedMaps: false,
                    preselectedMapNames: [],
                    isRandomMaps: true,
                    isJDVersionMap: false,
                    JDVersionMaps: [],
                    isDifficultyOnly: false,
                    difficultyOnly: [],
                    containsSpecificArtist: false,
                    specificArtist: "",
                    isOnlyCoachCount: false,
                    coachCountOnly: [],
                    excludeBannedMaps: true
                }
            }
        }
    }
};

module.exports = screenConfig;