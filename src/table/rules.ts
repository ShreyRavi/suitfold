/**
 * How to play, in plain words.
 *
 * suitfold enforces none of this - the rules live in the heads of the people at
 * the table. That is exactly why they are written down here: if the app will
 * not settle an argument, the least it can do is remind everyone what the
 * argument is about.
 */

export interface RuleSection {
  title: string
  items: string[]
}

export interface Rules {
  goal: string
  players: string
  setup: string[]
  play: string[]
  winning: string
  sections?: RuleSection[]
}

/** Best to worst. The list people actually reach for mid-hand. */
export const POKER_HANDS: RuleSection = {
  title: 'Which hand beats which',
  items: [
    'Royal flush - 10, J, Q, K, A all in one suit. The best hand there is.',
    'Straight flush - five in a row, all one suit, like 5-6-7-8-9 of hearts.',
    'Four of a kind - all four of the same number, like four 7s.',
    'Full house - three of one number and two of another, like three 9s and two Kings.',
    'Flush - any five cards of the same suit, in no order.',
    'Straight - five in a row of mixed suits, like 4-5-6-7-8.',
    'Three of a kind - three of the same number.',
    'Two pair - two of one number and two of another.',
    'One pair - two of the same number.',
    'High card - none of the above. Your biggest card is your hand.',
  ],
}

export const POKER_EDGE: RuleSection = {
  title: 'The bits people argue about',
  items: [
    'The ace is both the lowest and the highest card. A-2-3-4-5 is a straight (the smallest one) and 10-J-Q-K-A is a straight (the biggest one). K-A-2 is NOT a straight - it does not wrap around.',
    'If two people have the same pair, the next highest card decides it. That card is called the kicker. Keep going card by card until something differs.',
    'Flushes are compared card by card, all five of them - not just the highest one.',
    'Suits never break a tie. There is no "spades beat hearts" in poker.',
    'If two hands are genuinely identical, the pot is split. Any odd chip goes to the first player left of the dealer.',
    'Your best five cards win, using any mix of your two and the five in the middle - including all five in the middle and neither of yours. That is called playing the board, and everyone still in usually ties.',
    'You can only lose the chips you have in front of you. If you are all-in for less than someone bets, you can only win the part everyone matched. The rest is a side pot you are not in.',
  ],
}

export const RULES: Record<string, Rules> = {
  'chinese-checkers': {
    goal: 'Get all ten of your marbles across to the point of the star opposite you.',
    players: '2 to 6',
    setup: [
      'The board is a six pointed star. Every point holds ten marbles of one colour.',
      'Take the point nearest you. With two players take opposite points, with three take alternate ones, with six take the lot.',
      'Any point you are not using can be left full or cleared off to the side.',
    ],
    play: [
      'Take turns. On your turn you move one marble, and one only.',
      'A step: slide a marble into any touching empty hole, in any of the six directions.',
      'A hop: jump a marble straight over one neighbouring marble of any colour into the empty hole directly beyond it.',
      'A hop can be followed by another hop, and another, as far as you can keep going. One turn can cross the whole board.',
      'You may not step and hop in the same turn, and you never take anything off the board.',
    ],
    winning: 'The first person to fill the ten holes of the far point with their own marbles has won.',
    sections: [
      {
        title: 'The arguments people have',
        items: [
          'Somebody parks a marble in their home point and refuses to move it, so the other side can never fill it. The usual house rule is that it counts as filled if you have got every hole you can and the rest are held by somebody else.',
          'Hopping over a marble sitting in its own home is allowed. Landing there and staying is what is not.',
          'Some families allow a long hop over any number of empty holes. It is a different game, and a faster one. Agree before you start, not halfway through.',
        ],
      },
    ],
  },

  holdem: {
    goal: 'Make the best five-card hand, or bet hard enough that everyone else gives up.',
    players: '2 to 10',
    setup: [
      'Everyone gets two cards face down that only they can see.',
      'Five cards go face down in the middle. These are shared by everybody.',
      'Everyone starts with the same pile of chips.',
    ],
    play: [
      'Bet, then turn over the first three middle cards (the flop). Bet again, turn over the fourth (the turn). Bet again, turn over the fifth (the river). Bet one last time.',
      'On your turn you can fold (give up the hand), check (do nothing, only if nobody has bet), call (match the bet), or raise (bet more).',
      'If you fold you lose whatever you already put in, and you are out until the next hand.',
      'When the betting is done and more than one person is left, everyone shows their cards.',
    ],
    winning: 'Best five-card hand takes the pot. Press Take pot and it goes to your stack.',
    sections: [POKER_HANDS, POKER_EDGE],
  },

  'indian-rummy': {
    goal: 'Arrange all 13 of your cards into tidy groups before anyone else.',
    players: '2 to 6',
    setup: [
      'Two decks shuffled together with jokers. Everybody gets 13 cards.',
      'One card is turned face up - every card of that number is a joker for this hand, on top of the printed jokers.',
    ],
    play: [
      'On your turn take one card, from the face-down pile or the face-up one, then throw one away. You always end your turn with 13.',
      'You are trying to build runs and sets. A run is three or more in a row in the same suit, like 4-5-6 of hearts. A set is three or four of the same number in different suits.',
      'Jokers can stand in for any missing card - except inside your one pure run.',
    ],
    winning:
      'You need every card in a group, at least two runs, and at least one of those runs pure (no joker in it). Then you can declare.',
    sections: [
      {
        title: 'The pure run rule',
        items: [
          'A pure run is three or more in a row, same suit, with no joker helping. You must have one. Without it you cannot finish, no matter how tidy the rest is.',
          'You need a second run too, but that one is allowed a joker.',
          'The ace sits at both ends: A-2-3 is a run and Q-K-A is a run. K-A-2 is not.',
          'A set must be different suits. Two 7s of hearts and a 7 of spades is not a set, even from two decks.',
        ],
      },
    ],
  },

  gin: {
    goal: 'Group your ten cards and get out before your opponent.',
    players: '2',
    setup: ['Ten cards each. The rest is the draw pile, with one card turned up beside it.'],
    play: [
      'Take one card, then throw one away.',
      'Build runs (three or more in a row, same suit) and sets (three or four of the same number).',
      'Cards left over are called deadwood, and they count against you. Face cards are 10, aces are 1, everything else is its number.',
    ],
    winning:
      'Knock when your deadwood adds up to 10 or less. If you have none at all, that is gin and it is worth extra.',
  },

  blackjack: {
    goal: 'Get closer to 21 than the dealer, without going over.',
    players: '2 to 7',
    setup: ['Two cards each. The dealer takes two as well, one of them face up.'],
    play: [
      'Number cards are worth their number. Jack, Queen and King are 10. An ace is 1 or 11, whichever helps you.',
      'Hit to take another card. Stand to stop. Go over 21 and you are bust, straight away.',
      'When everyone has stopped, the dealer turns over and keeps taking cards until they reach 17 or more.',
    ],
    winning: 'Beat the dealer without busting. If the dealer busts, everyone still in wins.',
    sections: [
      {
        title: 'Worth knowing',
        items: [
          'An ace and a ten-card as your first two is blackjack, and normally pays one and a half times your bet.',
          'If you and the dealer tie, nobody wins and you keep your bet. That is a push.',
          'A hand with an ace counted as 11 is soft - you cannot bust by taking one more card, because the ace can drop to 1.',
        ],
      },
    ],
  },

  hearts: {
    goal: 'Collect as few points as possible. This is a game you try to lose.',
    players: '4',
    setup: ['All 52 cards dealt out, 13 each.'],
    play: [
      'Whoever has the 2 of clubs plays it. Going clockwise, everyone puts down one card.',
      'You must follow the suit that was led if you can. If you cannot, play anything.',
      'Highest card of the suit that was led takes all four cards. That is a trick. Whoever took it leads the next one.',
    ],
    winning: 'Every heart you collect is 1 point. The Queen of spades is 13. Lowest score wins.',
    sections: [
      {
        title: 'Shooting the moon',
        items: [
          'If you collect every heart AND the Queen of spades, you get zero and everyone else gets 26. It is very hard and very satisfying.',
          'You cannot lead a heart until somebody has already thrown one away on another suit.',
        ],
      },
    ],
  },

  spades: {
    goal: 'Say how many tricks you will win, then win exactly that many.',
    players: '4, in two teams',
    setup: ['13 cards each. Sit so partners are opposite each other.'],
    play: [
      'Before playing, everyone says how many tricks they think they will take. Partners add their guesses together.',
      'Follow the suit that was led if you can. Highest card of that suit wins the trick.',
      'Spades are trumps: any spade beats any card of another suit. You cannot lead spades until somebody has been unable to follow suit and played one.',
    ],
    winning:
      'Make your team’s bid and you score 10 per trick. Miss it and you lose 10 per trick you bid. First to 500 wins.',
    sections: [
      {
        title: 'Sandbags',
        items: [
          'Tricks you take beyond your bid are worth 1 each, but they pile up. Every ten of them costs you 100 points, so taking too many is its own punishment.',
        ],
      },
    ],
  },

  euchre: {
    goal: 'Win three of the five tricks.',
    players: '4, in two teams',
    setup: ['Only 9 up to Ace, so 24 cards. Five each, one card turned up to suggest trumps.'],
    play: [
      'One suit is trumps and beats everything else.',
      'Follow the suit that was led if you can. Highest card wins, unless somebody plays a trump.',
    ],
    winning: 'Three tricks wins the hand. All five is worth extra.',
    sections: [
      {
        title: 'The strange bit: bowers',
        items: [
          'The Jack of the trump suit is the best card in the game. It is called the right bower.',
          'The other Jack of the same colour becomes a trump too, and is second best. That is the left bower - and it stops being its own suit for the whole hand.',
          'So if hearts are trumps, the Jack of diamonds is a heart. This surprises everybody the first time.',
        ],
      },
    ],
  },

  cribbage: {
    goal: 'Score 121 points by making fifteens, pairs and runs.',
    players: '2',
    setup: ['Six cards each. Each of you puts two into a spare hand called the crib, which belongs to the dealer.'],
    play: [
      'Cut a card and turn it up. It counts as part of everybody’s hand at the end.',
      'Take turns laying cards down, adding up as you go. Do not go past 31.',
      'Score as you play: making the total exactly 15 or 31 scores, as does pairing or continuing a run.',
    ],
    winning: 'First to 121.',
    sections: [
      {
        title: 'What scores',
        items: [
          'Any cards adding to 15 - two points, every combination counts separately.',
          'A pair is 2, three of a kind is 6, four of a kind is 12.',
          'A run of three or more, one point per card.',
          'Four cards of the same suit in your hand is 4, and 5 if the turned card matches too.',
          'The Jack of the turned card’s suit in your hand is one point. It is called his nobs, for no good reason.',
        ],
      },
    ],
  },

  'big-two': {
    goal: 'Get rid of all your cards first.',
    players: '3 to 4',
    setup: ['The whole deck dealt out evenly.'],
    play: [
      'Play a card or a combination into the middle. The next person must beat it with the same shape of thing, or pass.',
      'When everyone passes, the last person to play clears the middle and starts again with anything.',
    ],
    winning: 'First to run out of cards. In President, that person deals next round and gets the best cards.',
    sections: [
      {
        title: 'Card order',
        items: [
          'The 2 is the highest card, not the lowest. Then Ace, King, Queen, and down to 3.',
          'Combinations must match: a single beats a single, a pair beats a pair, five cards beat five cards.',
        ],
      },
    ],
  },

  uno: {
    goal: 'Be the first to get rid of all your cards.',
    players: '2 to 10',
    setup: ['Seven cards each. One card turned face up to start the discard pile.'],
    play: [
      'Play a card that matches the top one by colour or by number or symbol.',
      'If you cannot play anything, take a card from the pile. If you can play it, you may.',
    ],
    winning: 'First to no cards left.',
    sections: [
      {
        title: 'The special cards',
        items: [
          'Skip - the next person misses their turn.',
          'Reverse - play turns around and goes the other way. With two players it acts like a skip.',
          'Draw Two - the next person takes two and misses their turn.',
          'Wild - you choose which colour is in play now.',
          'Wild Draw Four - you choose the colour and the next person takes four. Officially you may only play it if you have nothing of the current colour.',
          'When you get down to one card, say "Uno". Forget, and get caught, and you take two.',
        ],
      },
    ],
  },

  'crazy-eights': {
    goal: 'Get rid of all your cards. It is Uno with an ordinary deck.',
    players: '2 to 7',
    setup: ['Seven cards each, one turned up to start the pile.'],
    play: [
      'Play a card matching the top one by suit or by number.',
      'If you cannot, take from the pile until you can.',
      'An 8 is wild - play it on anything and say which suit comes next.',
    ],
    winning: 'First to no cards left.',
  },

  bluff: {
    goal: 'Get rid of your cards. Lying is the whole point.',
    players: '3 to 8',
    setup: ['Deal the whole deck out. Use "All of them" in the Deal menu.'],
    play: [
      'The first player puts down some cards FACE DOWN and says what they are, starting with aces. "Two aces."',
      'The next player does the same with twos, then threes, and so on up the ranks.',
      'You do not have to be telling the truth. You almost never are.',
      'Anyone can call you a liar. Turn the cards over: if you lied you take the whole pile, if you were honest the accuser takes it.',
    ],
    winning: 'First to empty their hand, and survive the last challenge.',
    sections: [
      {
        title: 'How to set it up here',
        items: [
          'Open Deal, choose "All of them", and deal to everyone.',
          'Play your cards face down into the middle with the Play face down button.',
          'When somebody calls a bluff, turn the pile over with Flip all in the pile menu.',
        ],
      },
    ],
  },

  'go-fish': {
    goal: 'Collect sets of four.',
    players: '2 to 6',
    setup: ['Seven cards each. The rest sits in the middle as the pond.'],
    play: [
      'Ask one person for a number you already hold. "Do you have any sevens?"',
      'If they do, they hand them all over and you go again.',
      'If they do not, they say "go fish" and you take one from the pond. Your turn ends.',
    ],
    winning: 'When all the cards are collected, whoever has the most sets of four wins.',
  },

  'old-maid': {
    goal: 'Do not be the one holding the odd queen at the end.',
    players: '2 to 8',
    setup: ['One queen is taken out, so one queen has no partner. Deal the whole deck out.'],
    play: [
      'Put down any pairs you already have.',
      'Take turns holding your cards out to the person on your left, face down, so they can take one at random.',
      'Any new pair goes down straight away.',
    ],
    winning: 'Everyone runs out except one person, left holding the lonely queen. They lose.',
  },

  war: {
    goal: 'Win every card. It takes no skill at all and children love it.',
    players: '2',
    setup: ['Split the deck in half, face down, one pile each.'],
    play: [
      'Both turn over your top card. Higher card takes both.',
      'If they match, that is war: put three cards face down each and turn over a fourth. Higher one takes the lot.',
    ],
    winning: 'Take all the cards. This can take a very long time.',
  },

  snap: {
    goal: 'Be fastest to spot two matching cards.',
    players: '2 to 6',
    setup: ['Deal the whole deck out. Use "All of them" in the Deal menu.'],
    play: [
      'Take turns turning one card face up into a shared pile.',
      'The moment the new card matches the one before it, shout SNAP.',
    ],
    winning: 'First to say it takes the pile. Whoever ends up with everything wins.',
  },

  memory: {
    goal: 'Remember where things are.',
    players: '2 or more',
    setup: ['The whole deck face down in a grid, nobody holding anything.'],
    play: [
      'Turn over two cards. If the numbers match, keep them and go again.',
      'If they do not match, turn them back face down and it is the next person’s turn.',
    ],
    winning: 'Most pairs when the table is empty.',
  },
}

/** Games with no rules of their own - you brought your own. */
export const NO_RULES: Rules = {
  goal: 'Whatever you like. This is just a table with cards on it.',
  players: 'any',
  setup: ['The cards come out and nothing else happens.'],
  play: [
    'Drag cards around. Double-click one to turn it over.',
    'Drag the number on a pile to move the whole pile.',
    'Drag a card to the bottom of the screen to put it in your hand, where only you can see it.',
  ],
  winning: 'Up to you entirely.',
}

export const rulesFor = (id: string): Rules => RULES[id] ?? NO_RULES
export const hasRules = (id: string): boolean => id in RULES
